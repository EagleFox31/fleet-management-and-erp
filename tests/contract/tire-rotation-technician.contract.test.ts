import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { WORK_ORDER_ASSIGNEE_ERROR } from "../../server/services/work-order-assignee";
import { tireRotations, users, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestUser, createTestVehicle } from "../support/factories";

/**
 * POST /api/tire-rotations : le `technicianId` facultatif devient le technicien de l'OT créé avec la
 * rotation. Même cible que toute affectation d'OT (`assertWorkOrderAssignee`) : technicien ou chef
 * d'atelier, non supprimé. Un id inexistant, hors de la plage `integer`, d'un autre rôle ou d'un
 * utilisateur supprimé est refusé en 400 lisible, sans OT ni rotation créés.
 */

const ACTORS = { workshopManager: "workshop_manager" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let vehicleId = 0;
let technicianId = 0;

const rotation = (extra: Record<string, unknown> = {}) => ({
  rotation: { vehicleId, rotationDate: "2026-11-05", rotationMileage: 120000, rotationType: "front_to_back", ...extra },
});
const post = (extra: Record<string, unknown> = {}) =>
  session.call("POST", "/api/tire-rotations", { actor: "workshopManager", body: rotation(extra) });
const countFor = async () => ({
  workOrders: (await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, vehicleId))).length,
  rotations: (await db.select({ id: tireRotations.id }).from(tireRotations).where(eq(tireRotations.vehicleId, vehicleId))).length,
});

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const technician = await createTestUser({ role: "technician" });
  ids.userIds.push(technician.id);
  technicianId = technician.id;
}, 120000);

afterAll(async () => {
  if (vehicleId) {
    await db.delete(tireRotations).where(eq(tireRotations.vehicleId, vehicleId));
    await db.delete(workOrders).where(eq(workOrders.vehicleId, vehicleId));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("rotation de pneus : technicien de l'OT", { timeout: 60000 }, () => {
  it("technicien existant : 201, l'OT créé lui est affecté", async () => {
    const res = await post({ technicianId });
    expect(res.status).toBe(201);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, res.body.workOrder?.id ?? res.body.rotation?.workOrderId));
    expect(wo.technicianId).toBe(technicianId);
  });

  it("sans technicien : 201, OT sans technicien", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, res.body.workOrder?.id ?? res.body.rotation?.workOrderId));
    expect(wo.technicianId).toBeNull();
  });

  it("technicien inexistant : 400 lisible, ni OT ni rotation créés", async () => {
    const before = await countFor();
    const res = await post({ technicianId: 2147483000 });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe(WORK_ORDER_ASSIGNEE_ERROR);
    expect(await countFor()).toEqual(before);
  });

  it("cible hors atelier (chauffeur) : 400 sur le champ, ni OT ni rotation créés", async () => {
    const driver = await createTestUser({ role: "driver" });
    ids.userIds.push(driver.id);
    const before = await countFor();
    const res = await post({ technicianId: driver.id });
    expect(res.status).toBe(400);
    expect(res.body?.errors).toContainEqual({ field: "technicianId", message: WORK_ORDER_ASSIGNEE_ERROR });
    expect(await countFor()).toEqual(before);
  });

  it("technicien supprimé : 400, ni OT ni rotation créés", async () => {
    const removed = await createTestUser({ role: "technician" });
    ids.userIds.push(removed.id);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, removed.id));
    const before = await countFor();
    const res = await post({ technicianId: removed.id });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe(WORK_ORDER_ASSIGNEE_ERROR);
    expect(await countFor()).toEqual(before);
  });

  it("technicien hors plage integer : 400 sur le champ, ni OT ni rotation créés", async () => {
    const before = await countFor();
    const res = await post({ technicianId: 99999999999 });
    expect(res.status).toBe(400);
    expect(res.body?.errors).toContainEqual({
      field: "technicianId",
      message: "Technicien introuvable : choisissez un technicien de la liste.",
    });
    expect(await countFor()).toEqual(before);
  });
});
