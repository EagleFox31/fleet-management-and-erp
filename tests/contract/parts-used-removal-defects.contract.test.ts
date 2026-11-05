import { createServer, type Server } from "http";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts, partsStockMovements, partsUsed, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Retrait d'une pièce posée sur un OT (`DELETE /api/parts-used/:id`) : la pièce revient en
 * stock par un mouvement d'entrée attribué à l'acteur, la ligne posée disparaît. Un rôle hors
 * atelier est refusé sans toucher au stock. Écrit en base ; tout est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function sessionOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

/** Une pièce à 5 en stock, dont 2 posées sur un OT en cours. */
async function partUsedOnWorkOrder() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: 5, unitPrice: "4000.00" });
  ids.partIds.push(part.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST retrait pièce posée", status: "in_progress" })
    .returning();
  workOrderIds.push(workOrder.id);
  const [used] = await db
    .insert(partsUsed)
    .values({ workOrderId: workOrder.id, partId: part.id, quantity: 2, unitPrice: "4000.00" })
    .returning();
  return { part, workOrder, used };
}

const remove = (id: number, cookie: string) => fetch(`${baseUrl}/api/parts-used/${id}`, { method: "DELETE", headers: { Cookie: cookie } });

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function creditsOf(partId: number) {
  return db
    .select()
    .from(partsStockMovements)
    .where(and(eq(partsStockMovements.partId, partId), eq(partsStockMovements.movementType, "in")));
}

describe("DELETE /api/parts-used/:id : atomicité, rôles, statut de l'OT", () => {
  it("dix retraits simultanés : un 204, neuf 404, stock crédité une seule fois", async () => {
    const chef = await sessionOf("workshop_manager");
    const { part, used } = await partUsedOnWorkOrder();

    const responses = await Promise.all(Array.from({ length: 10 }, () => remove(used.id, chef.cookie)));

    expect(responses.filter((r) => r.status === 204)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 404)).toHaveLength(9);
    expect(await stockOf(part.id)).toBe(7);
    expect(await creditsOf(part.id)).toHaveLength(1);
  });

  it("id inconnu : 404 avec message utilisateur", async () => {
    const chef = await sessionOf("workshop_manager");
    const res = await remove(999999999, chef.cookie);
    expect(res.status).toBe(404);
    expect((await res.json()).message).toMatch(/introuvable/);
  });

  it("id invalide : 400 ; sans session : 401", async () => {
    const chef = await sessionOf("workshop_manager");
    expect((await fetch(`${baseUrl}/api/parts-used/12abc`, { method: "DELETE", headers: { Cookie: chef.cookie } })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/parts-used/1`, { method: "DELETE" })).status).toBe(401);
  });

  it("le technicien ne remet pas en stock : 403, ligne et stock intacts", async () => {
    const technician = await sessionOf("technician");
    const { part, used } = await partUsedOnWorkOrder();
    const res = await remove(used.id, technician.cookie);
    expect(res.status).toBe(403);
    expect(await stockOf(part.id)).toBe(5);
    expect(await db.select().from(partsUsed).where(eq(partsUsed.id, used.id))).toHaveLength(1);
  });

  it.each(["warehouse", "workshop_manager", "admin"] as const)("%s retire la pièce : 204, stock remonté, mouvement attribué", async (role) => {
    const actor = await sessionOf(role);
    const { part, workOrder, used } = await partUsedOnWorkOrder();
    const res = await remove(used.id, actor.cookie);
    expect(res.status).toBe(204);
    expect(await stockOf(part.id)).toBe(7);
    const [movement] = await creditsOf(part.id);
    expect(movement).toMatchObject({ quantity: 2, workOrderId: workOrder.id, createdBy: actor.user.id });
    expect(await db.select().from(partsUsed).where(eq(partsUsed.id, used.id))).toHaveLength(0);
  });

  it.each(["completed", "cancelled"] as const)("OT %s : retrait refusé (409), ligne et stock intacts", async (status) => {
    const chef = await sessionOf("workshop_manager");
    const { part, workOrder, used } = await partUsedOnWorkOrder();
    await db.update(workOrders).set({ status }).where(eq(workOrders.id, workOrder.id));
    const res = await remove(used.id, chef.cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/ajustement de stock/);
    expect(await stockOf(part.id)).toBe(5);
    expect(await db.select().from(partsUsed).where(eq(partsUsed.id, used.id))).toHaveLength(1);
  });

  it("crédit en échec : tout est annulé (la ligne reste), réponse 500 sans détail technique", async () => {
    const chef = await sessionOf("workshop_manager");
    const { part, workOrder, used } = await partUsedOnWorkOrder();
    // Déclencheur local au test : refuse tout mouvement d'entrée de cet OT.
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION test_refuse_parts_used_credit() RETURNS trigger AS $$
      BEGIN
        IF NEW.work_order_id = ${workOrder.id} THEN RAISE EXCEPTION 'TEST refus du credit'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_refuse_parts_used_credit ON parts_stock_movements;
      CREATE TRIGGER test_refuse_parts_used_credit BEFORE INSERT ON parts_stock_movements
        FOR EACH ROW EXECUTE FUNCTION test_refuse_parts_used_credit();`));
    try {
      const res = await remove(used.id, chef.cookie);
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toMatch(/TEST refus|trigger|parts_stock_movements/i);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS test_refuse_parts_used_credit ON parts_stock_movements; DROP FUNCTION IF EXISTS test_refuse_parts_used_credit();"));
    }
    expect(await db.select().from(partsUsed).where(eq(partsUsed.id, used.id))).toHaveLength(1);
    expect(await stockOf(part.id)).toBe(5);
  });
});
