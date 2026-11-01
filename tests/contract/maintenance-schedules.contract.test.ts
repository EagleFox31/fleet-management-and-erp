import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, workOrders } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * MNT1, plan de maintenance : création, lecture, modification, désactivation,
 * suppression, droits par rôle, corps invalides.
 */

type Actor = "manager" | "technician" | "clientA" | "clientB";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const scheduleIds: number[] = [];

const validBody = (vehicleId: number, overrides: Record<string, unknown> = {}) => ({
  vehicleId,
  title: "TEST vidange",
  frequency: "monthly",
  frequencyValue: 3,
  scheduledDate: "2031-06-15",
  ...overrides,
});

async function createSchedule(vehicleId: number, overrides: Record<string, unknown> = {}) {
  const res = await session.call("POST", "/api/maintenance-schedules", { actor: "manager", body: validBody(vehicleId, overrides) });
  if (res.status === 201) scheduleIds.push(res.body.id);
  return res;
}

async function newVehicle(ownerId?: number) {
  const vehicle = await createTestVehicle({ ownerId });
  session.ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    manager: "workshop_manager",
    technician: "technician",
    clientA: "client",
    clientB: "client",
  });
}, 60000);

afterAll(async () => {
  if (scheduleIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.maintenanceScheduleId, scheduleIds));
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.id, scheduleIds));
  }
  await session.stop();
});

describe("MNT1 : plan de maintenance", { timeout: 60000 }, () => {
  it("refuse la création sans session (401) et à un technicien (403), sans rien écrire", async () => {
    const vehicle = await newVehicle();
    const anonymous = await session.call("POST", "/api/maintenance-schedules", { actor: null, body: validBody(vehicle.id) });
    expect(anonymous.status).toBe(401);
    const technician = await session.call("POST", "/api/maintenance-schedules", { actor: "technician", body: validBody(vehicle.id) });
    expect(technician.status).toBe(403);
    const rows = await db.select({ id: maintenanceSchedules.id }).from(maintenanceSchedules).where(eq(maintenanceSchedules.vehicleId, vehicle.id));
    expect(rows).toHaveLength(0);
  });

  it("répond 400 (jamais 500) à un corps invalide et 404 à un véhicule inconnu", async () => {
    const vehicle = await newVehicle();
    const invalid: Record<string, unknown>[] = [
      { title: "" },
      { frequency: "hourly" },
      { frequencyValue: 0 },
      { scheduledDate: "demain" },
      { scheduledDate: "2031-13-45" },
      { vehicleId: "abc" },
    ];
    for (const overrides of invalid) {
      const res = await session.call("POST", "/api/maintenance-schedules", { actor: "manager", body: validBody(vehicle.id, overrides) });
      expect(res.status, JSON.stringify(overrides)).toBe(400);
    }
    expect((await session.call("POST", "/api/maintenance-schedules", { actor: "manager", body: {} })).status).toBe(400);
    const unknown = await session.call("POST", "/api/maintenance-schedules", { actor: "manager", body: validBody(2147483000) });
    expect(unknown.status).toBe(404);
    const rows = await db.select({ id: maintenanceSchedules.id }).from(maintenanceSchedules).where(eq(maintenanceSchedules.vehicleId, vehicle.id));
    expect(rows).toHaveLength(0);
  });

  it("crée un plan actif, le relit par véhicule et génère l'OT préventif lié", async () => {
    const vehicle = await newVehicle();
    const res = await createSchedule(vehicle.id, { title: "TEST révision", description: "contrôle complet" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicleId: vehicle.id, title: "TEST révision", isActive: true, frequency: "monthly", frequencyValue: 3 });

    const list = await session.call("GET", `/api/maintenance-schedules/vehicle/${vehicle.id}`, { actor: "technician" });
    expect(list.status).toBe(200);
    expect(list.body.map((s: any) => s.id)).toEqual([res.body.id]);

    const generated = await db.select().from(workOrders).where(eq(workOrders.maintenanceScheduleId, res.body.id));
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ vehicleId: vehicle.id, isPreventive: true, status: "pending" });
  });

  it("un plan créé inactif n'engendre aucun OT", async () => {
    const vehicle = await newVehicle();
    const res = await createSchedule(vehicle.id, { isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(false);
    const generated = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.maintenanceScheduleId, res.body.id));
    expect(generated).toHaveLength(0);
  });

  it("modifie un plan (PATCH), refuse un corps vide ou invalide en 400, un id inconnu en 404", async () => {
    const vehicle = await newVehicle();
    const { body: schedule } = await createSchedule(vehicle.id, { isActive: false });

    const patched = await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, {
      actor: "manager",
      body: { title: "TEST renommé", frequencyValue: 6 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ id: schedule.id, title: "TEST renommé", frequencyValue: 6 });

    expect((await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager", body: {} })).status).toBe(400);
    expect((await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager", body: { frequencyValue: "beaucoup" } })).status).toBe(400);
    expect((await session.call("PATCH", "/api/maintenance-schedules/2147483000", { actor: "manager", body: { title: "x" } })).status).toBe(404);
    expect((await session.call("PATCH", "/api/maintenance-schedules/abc", { actor: "manager", body: { title: "x" } })).status).toBe(400);
    expect((await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "technician", body: { title: "x" } })).status).toBe(403);

    const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, schedule.id));
    expect(row.title).toBe("TEST renommé");
  });

  it("désactivation : le plan disparaît des plans actifs du véhicule, la réactivation le rend", async () => {
    const vehicle = await newVehicle();
    const { body: schedule } = await createSchedule(vehicle.id, { isActive: false });
    await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager", body: { isActive: true } });
    const active = await session.call("GET", `/api/maintenance-schedules/vehicle/${vehicle.id}`, { actor: "manager" });
    expect(active.body.map((s: any) => s.id)).toEqual([schedule.id]);

    const off = await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager", body: { isActive: false } });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const after = await session.call("GET", `/api/maintenance-schedules/vehicle/${vehicle.id}`, { actor: "manager" });
    expect(after.body).toEqual([]);

    const again = await session.call("PATCH", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager", body: { isActive: true } });
    expect(again.body.isActive).toBe(true);
  });

  it("supprime un plan sans OT (204 puis 404), refuse le technicien", async () => {
    const vehicle = await newVehicle();
    const { body: schedule } = await createSchedule(vehicle.id, { isActive: false });
    expect((await session.call("DELETE", `/api/maintenance-schedules/${schedule.id}`, { actor: "technician" })).status).toBe(403);
    expect((await session.call("DELETE", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager" })).status).toBe(204);
    expect((await session.call("DELETE", `/api/maintenance-schedules/${schedule.id}`, { actor: "manager" })).status).toBe(404);
    expect((await session.call("DELETE", "/api/maintenance-schedules/abc", { actor: "manager" })).status).toBe(400);
  });

  it("cloison : un client ne lit que les plans de ses véhicules", async () => {
    const vehicleA = await newVehicle(session.userId("clientA"));
    const vehicleB = await newVehicle(session.userId("clientB"));
    const { body: scheduleB } = await createSchedule(vehicleB.id, { isActive: false });

    const own = await session.call("GET", `/api/maintenance-schedules/vehicle/${vehicleA.id}`, { actor: "clientA" });
    expect(own.status).toBe(200);
    const foreign = await session.call("GET", `/api/maintenance-schedules/vehicle/${vehicleB.id}`, { actor: "clientA" });
    expect(foreign.status).toBe(403);
    const all = await session.call("GET", "/api/maintenance-schedules", { actor: "clientA" });
    expect(all.status).toBe(200);
    expect(all.body.map((s: any) => s.id)).not.toContain(scheduleB.id);
  });

  // Défaut : DELETE /api/maintenance-schedules/:id (server/routes.ts:1811) ignore
  // le résultat de `storage.deleteMaintenanceSchedule` (server/storage.ts:1192),
  // qui avale l'erreur de clé étrangère (work_orders.maintenance_schedule_id)
  // et renvoie false : la route répond 204 alors que le plan existe toujours.
  describe("plan portant un OT généré", () => {
    let scheduleWithWorkOrderId = 0;
    // Mise en place hors du `it.fails` : une erreur de préparation fait échouer
    // le hook au lieu de rendre le cas vert.
    beforeAll(async () => {
      const vehicle = await newVehicle();
      const created = await createSchedule(vehicle.id);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      scheduleWithWorkOrderId = created.body.id;
    }, 60000);

    it.fails("ne répond 204 que si le plan dont un OT a été généré est vraiment supprimé", async () => {
      const res = await session.call("DELETE", `/api/maintenance-schedules/${scheduleWithWorkOrderId}`, { actor: "manager" });
      const rows = await db.select({ id: maintenanceSchedules.id }).from(maintenanceSchedules).where(eq(maintenanceSchedules.id, scheduleWithWorkOrderId));
      if (res.status === 204) {
        expect(rows).toHaveLength(0);
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
    });
  });
});
