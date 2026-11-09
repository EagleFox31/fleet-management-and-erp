import { createServer, type Server } from "http";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { AWAITING_PARTS_MAX, INVENTORY_REPORT_MAX_PARTS } from "../../server/api/capped-statistics.routes";
import { parts, partsStockMovements, partRequirements, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Trois lectures qui calculaient sur une lecture plafonnée (50 lignes, ou 100) :
 * - GET /api/statistics/work-orders : comptes par statut sur TOUS les OT (agrégat SQL) ;
 * - GET /api/reports/inventory : statistiques sur TOUTES les pièces, 422 au-delà de la borne ;
 * - GET /api/work-orders/awaiting-parts : liste complète, 422 au-delà de la borne.
 * Les comptes se mesurent en écart par rapport à l'état initial (la base peut contenir d'autres lignes).
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const partIds: number[] = [];
const cookies: Partial<Record<TestUserRole, string>> = {};
let vehicleId = 0;
let minQuantityWasNotNull = false;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.get("set-cookie")!.split(";")[0];
}

const get = (path: string, role: TestUserRole) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies[role]! } });

async function insertWorkOrders(status: "pending" | "in_progress" | "awaiting_parts" | "completed" | "cancelled", n: number) {
  for (let from = 0; from < n; from += 500) {
    const size = Math.min(500, n - from);
    const rows = await db
      .insert(workOrders)
      .values(Array.from({ length: size }, (_, i) => ({ vehicleId, title: `TEST-CAPSTAT ${status} ${from + i}`, status })))
      .returning({ id: workOrders.id });
    workOrderIds.push(...rows.map((row) => row.id));
  }
}

async function insertParts(rows: { quantity: number; minQuantity: number | null; unitPrice: string }[]) {
  for (let from = 0; from < rows.length; from += 500) {
    const chunk = rows.slice(from, from + 500);
    const inserted = await db
      .insert(parts)
      .values(
        chunk.map((row, i) => ({
          name: `TEST-CAPSTAT piece ${from + i}`,
          reference: `TEST-CAPSTAT-${Date.now()}-${from + i}`,
          quantity: row.quantity,
          minQuantity: row.minQuantity as number,
          unitPrice: row.unitPrice,
          unit: "pièce",
          category: "TEST",
        })),
      )
      .returning({ id: parts.id });
    partIds.push(...inserted.map((row) => row.id));
  }
}

async function countOf(table: "work_orders" | "parts", where = sql`true`) {
  const result = await db.execute(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`);
  return Number((result.rows[0] as { n: number }).n);
}

async function purge() {
  // Les suppressions passent par des lots : jamais plus de quelques milliers d'identifiants dans un IN.
  for (let i = 0; i < partIds.length; i += 1000) {
    const chunk = partIds.slice(i, i + 1000);
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, chunk));
    await db.delete(parts).where(inArray(parts.id, chunk));
  }
  partIds.length = 0;
  for (let i = 0; i < workOrderIds.length; i += 1000) {
    const chunk = workOrderIds.slice(i, i + 1000);
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, chunk));
    await db.delete(workOrders).where(inArray(workOrders.id, chunk));
  }
  workOrderIds.length = 0;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const role of ["admin", "workshop_manager", "warehouse", "technician", "client"] as const) await login(role);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;

  // Une pièce sans seuil (min_quantity NULL) doit compter comme un seuil à 0. La colonne est NOT NULL
  // dans le schéma : la contrainte est levée le temps du test, puis rétablie (afterAll).
  const nullable = await db.execute(
    sql`select is_nullable from information_schema.columns where table_name = 'parts' and column_name = 'min_quantity'`,
  );
  minQuantityWasNotNull = (nullable.rows[0] as { is_nullable: string }).is_nullable === "NO";
  if (minQuantityWasNotNull) await db.execute(sql`alter table parts alter column min_quantity drop not null`);
}, 120000);

afterAll(async () => {
  await purge();
  if (minQuantityWasNotNull) {
    await db.execute(sql`update parts set min_quantity = 0 where min_quantity is null and reference like 'TEST-CAPSTAT-%'`);
    const leftovers = await countOf("parts", sql`min_quantity is null`);
    if (leftovers === 0) await db.execute(sql`alter table parts alter column min_quantity set not null`);
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}, 120000);

describe("GET /api/statistics/work-orders : comptes sur tous les OT", { timeout: 120000 }, () => {
  it("compte exactement plus de 50 OT, tous statuts confondus", async () => {
    const base = await (await get("/api/statistics/work-orders", "workshop_manager")).json();
    const baseTotal = await countOf("work_orders");
    await insertWorkOrders("pending", 23);
    await insertWorkOrders("in_progress", 17);
    await insertWorkOrders("completed", 29);
    await insertWorkOrders("awaiting_parts", 4);
    await insertWorkOrders("cancelled", 3);

    const res = await get("/api/statistics/work-orders", "workshop_manager");
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(Object.keys(stats).sort()).toEqual(["completed", "inProgress", "pending", "total"]);
    expect(stats.pending - base.pending).toBe(23);
    expect(stats.inProgress - base.inProgress).toBe(17);
    expect(stats.completed - base.completed).toBe(29);
    // total = tous les OT (awaiting_parts et cancelled inclus), comme la longueur de liste d'origine.
    expect(stats.total).toBe(baseTotal + 76);
  });

  it("client : 403", async () => {
    expect((await get("/api/statistics/work-orders", "client")).status).toBe(403);
  });
});

describe("GET /api/reports/inventory : statistiques sur toutes les pièces", { timeout: 300000 }, () => {
  const STAT_KEYS = ["lowStockCount", "totalMovements", "totalParts", "totalValue"];

  it("témoin (moins de 50 lignes) : forme et valeurs inchangées", async () => {
    const baseParts = await countOf("parts");
    expect(baseParts).toBeLessThan(50);
    await insertParts([
      { quantity: 2, minQuantity: 5, unitPrice: "10.50" }, // bas
      { quantity: 5, minQuantity: 5, unitPrice: "2.00" }, // bas (égal au seuil)
      { quantity: 9, minQuantity: 5, unitPrice: "3.25" }, // normal
      { quantity: 0, minQuantity: null, unitPrice: "7.00" }, // seuil NULL : 0 <= 0, bas
      { quantity: 4, minQuantity: null, unitPrice: "1.00" }, // seuil NULL : 4 > 0, normal
    ]);
    const [low] = await db.select().from(parts).where(eq(parts.id, partIds[0]));
    await db.insert(partsStockMovements).values([
      { partId: low.id, movementType: "out", quantity: -3, previousStock: 5, newStock: 2 },
      { partId: low.id, movementType: "in", quantity: 4, previousStock: 2, newStock: 6 },
    ]);
    await db.insert(partsStockMovements).values({
      partId: low.id,
      movementType: "adjustment",
      quantity: 99,
      previousStock: 0,
      newStock: 99,
      createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
    });

    const res = await get("/api/reports/inventory", "warehouse");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["movements", "parts", "statistics"]);
    expect(Object.keys(body.statistics).sort()).toEqual(STAT_KEYS);
    expect(body.statistics.totalParts).toBe(baseParts + 5);
    expect(body.statistics.lowStockCount).toBe(3);
    expect(body.statistics.totalValue).toBeCloseTo(2 * 10.5 + 5 * 2 + 9 * 3.25 + 0 + 4 * 1, 2);
    // Période par défaut (30 jours) : l'ajustement d'il y a 400 jours est exclu.
    expect(body.statistics.totalMovements).toBe(2);
    expect(body.movements).toHaveLength(2);
    const enriched = body.parts.find((part: { id: number }) => part.id === low.id);
    expect(enriched.movementsCount).toBe(7);
    expect(enriched.movements).toHaveLength(2);
    expect(Object.keys(enriched.movements[0]).sort()).toEqual(
      [
        "createdAt", "date", "id", "movementType", "newStock", "notes", "partId", "partName", "partReference",
        "performedBy", "performedByName", "previousStock", "quantity", "reason", "workOrderId", "workOrderTitle",
      ].sort(),
    );
    const untouched = body.parts.find((part: { id: number }) => part.id === partIds[2]);
    expect(untouched.movementsCount).toBe(0);
    expect(untouched.movements).toEqual([]);
  });

  it("période explicite : les mouvements anciens reviennent par le filtre SQL", async () => {
    const from = new Date(Date.now() - 500 * 24 * 3600 * 1000).toISOString();
    const res = await get(`/api/reports/inventory?startDate=${encodeURIComponent(from)}`, "warehouse");
    expect(res.status).toBe(200);
    expect((await res.json()).statistics.totalMovements).toBe(3);
  });

  it("plus de 50 pièces : totalParts, totalValue et lowStockCount exacts", async () => {
    const before = await (await get("/api/reports/inventory", "warehouse")).json();
    const rows: { quantity: number; minQuantity: number | null; unitPrice: string }[] = [];
    for (let i = 0; i < 20; i++) rows.push({ quantity: 2, minQuantity: 5, unitPrice: "2.50" }); // bas
    for (let i = 0; i < 20; i++) rows.push({ quantity: 5, minQuantity: 5, unitPrice: "2.50" }); // bas (égal)
    for (let i = 0; i < 12; i++) rows.push({ quantity: 10, minQuantity: 5, unitPrice: "2.50" }); // normal
    for (let i = 0; i < 6; i++) rows.push({ quantity: 0, minQuantity: null, unitPrice: "2.50" }); // NULL : bas
    for (let i = 0; i < 3; i++) rows.push({ quantity: 3, minQuantity: null, unitPrice: "2.50" }); // NULL : normal
    await insertParts(rows);

    const res = await get("/api/reports/inventory", "warehouse");
    expect(res.status).toBe(200);
    const after = (await res.json()).statistics;
    expect(after.totalParts - before.statistics.totalParts).toBe(61);
    expect(after.lowStockCount - before.statistics.lowStockCount).toBe(46);
    expect(after.totalValue - before.statistics.totalValue).toBeCloseTo((2 * 20 + 5 * 20 + 10 * 12 + 0 + 3 * 3) * 2.5, 2);
    expect(after.totalParts).toBe(await countOf("parts"));
  });

  it(`au-delà de ${INVENTORY_REPORT_MAX_PARTS} pièces : 422 explicite, sans tronquer`, async () => {
    const present = await countOf("parts");
    const missing = INVENTORY_REPORT_MAX_PARTS + 1 - present;
    await insertParts(Array.from({ length: missing }, () => ({ quantity: 1, minQuantity: 1, unitPrice: "1.00" })));
    const res = await get("/api/reports/inventory", "warehouse");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toContain(String(INVENTORY_REPORT_MAX_PARTS + 1));
    expect(JSON.stringify(body)).not.toMatch(/select |from "|stack/i);
    await purge();
  });

  it("client : 403", async () => {
    expect((await get("/api/reports/inventory", "client")).status).toBe(403);
    expect((await get("/api/reports/inventory", "technician")).status).toBe(403);
  });
});

describe("GET /api/work-orders/awaiting-parts : liste complète", { timeout: 300000 }, () => {
  it("101 OT en attente de pièces : tous reviennent, avec le même enrichissement", async () => {
    const base = await (await get("/api/work-orders/awaiting-parts", "workshop_manager")).json();
    const firstId = workOrderIds.length;
    await insertWorkOrders("awaiting_parts", 101);
    const created = workOrderIds.slice(firstId);
    const res = await get("/api/work-orders/awaiting-parts", "workshop_manager");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["total", "workOrders"]);
    expect(body.total).toBe(base.total + 101);
    expect(body.workOrders).toHaveLength(base.workOrders.length + 101);
    const returned = new Set(body.workOrders.map((wo: { id: number }) => wo.id));
    for (const id of created) expect(returned.has(id)).toBe(true);
    const sample = body.workOrders.find((wo: { id: number }) => wo.id === created[0]);
    expect(sample.vehicle).toMatchObject({ brand: "Renault", model: "T480" });
    expect(sample.pendingParts).toEqual([]);
    expect(sample.pendingPartsCount).toBe(0);
  });

  it(`au-delà de ${AWAITING_PARTS_MAX} OT : 422 explicite avec le nombre`, async () => {
    const present = await countOf("work_orders", sql`status = 'awaiting_parts'`);
    await insertWorkOrders("awaiting_parts", AWAITING_PARTS_MAX + 1 - present);
    const res = await get("/api/work-orders/awaiting-parts", "workshop_manager");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toBe(`Trop d'OT en attente de pièces pour un affichage complet (${AWAITING_PARTS_MAX + 1}).`);
    expect(body.truncated).toBeUndefined();
  });

  it("client : 403", async () => {
    expect((await get("/api/work-orders/awaiting-parts", "client")).status).toBe(403);
  });
});

