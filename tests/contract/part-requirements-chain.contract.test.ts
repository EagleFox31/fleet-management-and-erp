import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, parts, partsStockMovements, partsUsed, workOrders, type PartRequirement } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C — PRT4 : demande de pièce, chaîne complète par HTTP avec le rôle
 * réel de chaque étape, effet de stock vérifié en base, et annulation testée à
 * chaque étape (permise ou refusée selon `STATUS_TRANSITIONS` /
 * `STATUS_PERMISSIONS` de `server/services/part-requirements-workflow.ts`).
 */

type Actor = "technician" | "workshopManager" | "warehouse" | "admin";
const ACTORS: Record<Actor, TestUserRole> = {
  technician: "technician",
  workshopManager: "workshop_manager",
  warehouse: "warehouse",
  admin: "admin",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const workOrderIds: number[] = [];
const requirementIds: number[] = [];

async function call(method: string, path: string, options: { body?: unknown; actor?: Actor } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.actor ? { Cookie: cookies.get(options.actor)! } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const patch = (id: number, actor: Actor, body: Record<string, unknown>) =>
  call("PATCH", `/api/part-requirements/${id}`, { actor, body });

async function stockOf(partId: number): Promise<number> {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity ?? 0;
}

async function statusOf(id: number): Promise<string> {
  const [row] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, id));
  return row.status;
}

async function seedWorkOrder(): Promise<number> {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST PRT4", status: "in_progress", technicianId: userIds.get("technician")! })
    .returning();
  workOrderIds.push(workOrder.id);
  return workOrder.id;
}

/** Demande posée directement au statut voulu, demandée par le technicien. */
async function seedRequirement(status: PartRequirement["status"], stock = 5): Promise<{ id: number; partId: number }> {
  const part = await createTestPart({ quantity: stock });
  ids.partIds.push(part.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId: part.id, quantityNeeded: 2, reason: "TEST PRT4", status, requestedBy: userIds.get("technician")! })
    .returning();
  requirementIds.push(requirement.id);
  return { id: requirement.id, partId: part.id };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
  }
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("demande de pièce : chaîne complète (PRT4)", { timeout: 120000 }, () => {
  it("création → approbation → commande urgente → entrée en stock → sortie du stock vers l'OT", async () => {
    const part = await createTestPart({ quantity: 3 });
    ids.partIds.push(part.id);
    const workOrderId = await seedWorkOrder();

    // 1. Le technicien demande la pièce : la demande naît en attente, à son nom.
    const created = await call("POST", "/api/part-requirements", {
      actor: "technician",
      body: { partId: part.id, workOrderId, quantityNeeded: 2, reason: "TEST PRT4 chaîne" },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    requirementIds.push(id);
    expect(created.body).toMatchObject({ status: "pending", requestedBy: userIds.get("technician") });

    // 2. Le chef d'atelier approuve.
    expect((await patch(id, "workshopManager", { status: "approved" })).status).toBe(200);
    expect(await statusOf(id)).toBe("approved");

    // 3. Commande directe : refusée sans motif (le flux standard passe par Achats), acceptée avec.
    const noReason = await patch(id, "warehouse", { status: "ordered" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toMatch(/Achats/);
    const ordered = await patch(id, "warehouse", { status: "ordered", emergencyOverrideReason: "TEST urgence" });
    expect(ordered.status).toBe(200);
    expect(ordered.body.notes).toContain("OVERRIDE URGENCE");

    // 4. Entrée en stock par le magasinier : +2, demande et mouvement attribués au
    //    magasinier (PRT6), même si le corps prétend un autre réceptionnaire.
    const received = await patch(id, "warehouse", { status: "received", receivedBy: userIds.get("technician") });
    expect(received.status).toBe(200);
    expect(received.body.actualDeliveryDate).toBeTruthy();
    expect(received.body.receivedBy).toBe(userIds.get("warehouse"));
    expect(await stockOf(part.id)).toBe(5);
    const movementsIn = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
    expect(movementsIn).toEqual([expect.objectContaining({ movementType: "in", quantity: 2, createdBy: userIds.get("warehouse") })]);

    // 5. Sortie du stock vers l'OT : -2, pièce rattachée à l'OT.
    const issued = await call("POST", `/api/work-orders/${workOrderId}/part-requirements/${id}/issue`, { actor: "warehouse", body: {} });
    expect(issued.status).toBe(200);
    expect(await statusOf(id)).toBe("issued");
    expect(await stockOf(part.id)).toBe(3);
    const used = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrderId));
    expect(used).toEqual([expect.objectContaining({ partId: part.id, quantity: 2 })]);

    // 6. État final : plus aucune transition, même l'annulation.
    expect((await patch(id, "admin", { status: "cancelled" })).status).toBe(400);
    expect(await statusOf(id)).toBe("issued");
  });

  it("le PATCH générique ne marque pas une pièce sortie sans la déduire du stock", async () => {
    const { id, partId } = await seedRequirement("received", 5);
    const res = await patch(id, "warehouse", { status: "issued" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ordre de travail/);
    expect(await statusOf(id)).toBe("received");
    expect(await stockOf(partId)).toBe(5);
  });

  it("le réceptionnaire n'est jamais repris du corps hors réception (PRT6)", async () => {
    const { id } = await seedRequirement("received", 5);
    const res = await patch(id, "warehouse", { notes: "TEST PRT6", receivedBy: userIds.get("technician") });
    expect(res.status).toBe(200);
    expect(res.body.receivedBy).toBeNull();
  });
});

describe("demande de pièce : annulation à chaque étape (PRT4)", { timeout: 120000 }, () => {
  it("en attente : le chef d'atelier annule", async () => {
    const { id } = await seedRequirement("pending");
    expect((await patch(id, "workshopManager", { status: "cancelled" })).status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("approuvée : le chef d'atelier annule, le magasinier est refusé", async () => {
    const { id } = await seedRequirement("approved");
    const refused = await patch(id, "warehouse", { status: "cancelled" });
    expect(refused.status).toBe(400);
    expect(await statusOf(id)).toBe("approved");
    expect((await patch(id, "workshopManager", { status: "cancelled" })).status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("commandée : pas d'annulation directe, demande d'annulation puis décision de l'admin", async () => {
    const { id } = await seedRequirement("ordered");
    expect((await patch(id, "workshopManager", { status: "cancelled" })).status).toBe(400);

    expect((await patch(id, "workshopManager", { status: "cancel_requested" })).status).toBe(200);
    // La décision finale revient à l'admin seul.
    expect((await patch(id, "workshopManager", { status: "cancelled" })).status).toBe(400);
    expect(await statusOf(id)).toBe("cancel_requested");
    expect((await patch(id, "admin", { status: "cancelled" })).status).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("annulation refusée par l'admin : la demande reprend le cycle à « approuvée »", async () => {
    const { id } = await seedRequirement("cancel_requested");
    expect((await patch(id, "admin", { status: "approved" })).status).toBe(200);
    expect(await statusOf(id)).toBe("approved");
  });

  it("entrée en stock : plus d'annulation, le stock ne bouge pas", async () => {
    const { id, partId } = await seedRequirement("received", 5);
    expect((await patch(id, "admin", { status: "cancelled" })).status).toBe(400);
    expect((await patch(id, "admin", { status: "cancel_requested" })).status).toBe(400);
    expect(await statusOf(id)).toBe("received");
    expect(await stockOf(partId)).toBe(5);
  });

  it("annulée ou refusée : état final", async () => {
    for (const status of ["cancelled", "rejected"] as const) {
      const { id } = await seedRequirement(status);
      expect((await patch(id, "admin", { status: "pending" })).status).toBe(400);
      expect((await patch(id, "admin", { status: "approved" })).status).toBe(400);
      expect(await statusOf(id)).toBe(status);
    }
  });
});
