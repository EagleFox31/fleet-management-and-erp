import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { partRequirements, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison (AGENTS.md §11) des événements d'ordre de travail. Ils partaient en broadcast : tout
 * compte connecté, client compris, recevait l'OT (titre, coûts, pièces) de n'importe quel véhicule.
 * Attendu : le personnel hors chauffeur reçoit la trame complète ; un client ne reçoit aucune
 * trame d'OT, ni pour le véhicule d'un autre client ni pour le sien (aucun écran client ne les
 * écoute) ; le chauffeur ne reçoit aucune trame qui porte l'OT.
 *
 * Les trames sont capturées à `broadcastUpdate`, puis leur portée est résolue comme
 * `server/lib/realtime-scope.ts` (fermée par défaut).
 */

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; data: Record<string, unknown> };
type Recipient = { userId: number; role: string };

const reaches = (scope: Scope | undefined, recipient: Recipient): boolean => {
  if (!scope) return false;
  if (scope.type === "broadcast") return true;
  if (scope.type === "user") return (scope.userIds ?? []).includes(recipient.userId);
  if (scope.type === "roles") return (scope.roles ?? []).map((r) => r.trim().toLowerCase()).includes(recipient.role);
  return false;
};

type Actor = "admin" | "manager" | "technician" | "warehouse" | "clientA" | "clientB" | "driver";
const ROLE: Record<Actor, "admin" | "workshop_manager" | "technician" | "warehouse" | "client" | "driver"> = {
  admin: "admin",
  manager: "workshop_manager",
  technician: "technician",
  warehouse: "warehouse",
  clientA: "client",
  clientB: "client",
  driver: "driver",
};

const ids = createIdBag();
const workOrderIds: number[] = [];
const requirementIds: number[] = [];
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let actors: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let vehicleA: number;
let vehicleB: number;

const who = (actor: Actor): Recipient => ({ userId: actors.userIdOf(actor), role: ROLE[actor] });
const framesFor = (actor: Actor, eventType?: string) =>
  captured.filter((frame) => (!eventType || frame.eventType === eventType) && reaches(frame.scope, who(actor)));

async function seedWorkOrder(vehicleId: number, technicianId?: number): Promise<number> {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: uniqueTestToken("OT"), status: "pending", technicianId: technicianId ?? null })
    .returning();
  workOrderIds.push(row.id);
  return row.id;
}

/** Aucun client, ni A ni B, ne reçoit de trame d'OT ; le chauffeur non plus. */
function expectClosed(eventType: string) {
  expect(captured.some((frame) => frame.eventType === eventType)).toBe(true);
  expect(framesFor("clientA", eventType)).toEqual([]);
  expect(framesFor("clientB", eventType)).toEqual([]);
  expect(framesFor("driver", eventType)).toEqual([]);
  expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
}

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: Record<string, unknown>) => {
    captured.push({ eventType, scope: data?.scope as Scope | undefined, data: data ?? {} });
  });
  actors = await startContractActors<Actor>(ROLE, ids.userIds);
  const vA = await createTestVehicle({ ownerId: actors.userIdOf("clientA") });
  const vB = await createTestVehicle({ ownerId: actors.userIdOf("clientB") });
  ids.vehicleIds.push(vA.id, vB.id);
  vehicleA = vA.id;
  vehicleB = vB.id;
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (requirementIds.length > 0) await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  if (workOrderIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await actors?.close();
}, 120000);

describe("Ordres de travail : portée des trames temps réel (§11)", { timeout: 180000 }, () => {
  it("work_order_created (POST) : personnel en entier, aucun client, ni propriétaire ni autre", async () => {
    for (const vehicleId of [vehicleB, vehicleA]) {
      captured.length = 0;
      const res = await actors.call("POST", "/api/work-orders", {
        actor: "manager",
        body: { vehicleId, title: uniqueTestToken("OT"), description: "TEST portée", priority: "medium", status: "pending" },
      });
      expect(res.status).toBe(201);
      workOrderIds.push(res.body.id);
      expectClosed("work_order_created");
      const staff = framesFor("manager", "work_order_created");
      expect(staff).toHaveLength(1);
      expect(staff[0].data.workOrder).toBeTruthy();
      expect(framesFor("admin", "work_order_created")).toHaveLength(1);
    }
  });

  it("work_order_updated (PATCH) : le client A ne voit rien de l'OT du véhicule de B", async () => {
    const workOrderId = await seedWorkOrder(vehicleB);
    captured.length = 0;
    const res = await actors.call("PATCH", `/api/work-orders/${workOrderId}`, {
      actor: "admin",
      body: { description: "TEST portée modifiée" },
    });
    expect(res.status).toBe(200);
    expectClosed("work_order_updated");
    expect(framesFor("admin", "work_order_updated")).toHaveLength(1);
  });

  it("work_order_updated (technicien) : aucune trame vers un client", async () => {
    const workOrderId = await seedWorkOrder(vehicleB, actors.userIdOf("technician"));
    captured.length = 0;
    const res = await actors.call("PATCH", `/api/technician/work-orders/${workOrderId}/status`, {
      actor: "technician",
      body: { status: "in_progress" },
    });
    expect(res.status).toBe(200);
    expectClosed("work_order_updated");
    expect(framesFor("manager", "work_order_updated")[0].data.workOrder).toBeTruthy();
  });

  it("part_requirement_created : la demande (pièce, coût) ne part qu'au personnel hors chauffeur", async () => {
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const workOrderId = await seedWorkOrder(vehicleA);
    captured.length = 0;
    const res = await actors.call("POST", "/api/part-requirements", {
      actor: "technician",
      body: { partId: part.id, workOrderId, quantityNeeded: 1, reason: "TEST portée" },
    });
    expect(res.status).toBe(201);
    requirementIds.push(res.body.id);
    expectClosed("part_requirement_created");
    expect(framesFor("warehouse", "part_requirement_created")).toHaveLength(1);
  });

  it("work_order_deleted : aucun client ne l'apprend, le personnel oui", async () => {
    const workOrderId = await seedWorkOrder(vehicleB);
    captured.length = 0;
    const res = await actors.call("DELETE", `/api/work-orders/${workOrderId}`, { actor: "manager" });
    expect([200, 204]).toContain(res.status);
    expect(framesFor("clientA")).toEqual([]);
    expect(framesFor("clientB")).toEqual([]);
    expect(framesFor("manager", "work_order_deleted")).toHaveLength(1);
    expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
  });
});
