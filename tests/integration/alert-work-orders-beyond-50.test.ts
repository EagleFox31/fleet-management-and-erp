import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { alerts, workOrders } from "../../shared/schema";
import { db } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

/**
 * #297 (relecture) : le contrôle des OT lisait `storage.getWorkOrders()`, paginé à 50 et
 * trié par date de création décroissante. Un OT en retard plus ancien que les 50 derniers
 * créés n'était jamais contrôlé. Ici : un OT en retard créé en 2020, puis 55 OT ouverts
 * récents sans date de début (qui n'alertent pas). Rouge sur l'ancien appel.
 */
const ids = createIdBag();
const workOrderIds: number[] = [];
let technicianId = 0;
let overdueId = 0;

beforeAll(async () => {
  const technician = await createTestUser({ role: "technician" });
  ids.userIds.push(technician.id);
  technicianId = technician.id;
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);

  const [overdue] = await db
    .insert(workOrders)
    .values({
      vehicleId: vehicle.id,
      title: "OT ancien en retard",
      status: "pending",
      priority: "medium",
      technicianId,
      startDate: new Date("2020-01-10T08:00:00Z"),
      createdAt: new Date("2020-01-01T08:00:00Z"),
    } as typeof workOrders.$inferInsert)
    .returning({ id: workOrders.id });
  overdueId = overdue.id;
  workOrderIds.push(overdue.id);

  const recent = await db
    .insert(workOrders)
    .values(
      Array.from({ length: 55 }, (_, i) => ({
        vehicleId: vehicle.id,
        title: `OT récent ${i}`,
        status: "pending" as const,
        priority: "low" as const,
      })),
    )
    .returning({ id: workOrders.id });
  workOrderIds.push(...recent.map((r) => r.id));
}, 60_000);

afterAll(async () => {
  await db.delete(alerts).where(inArray(alerts.link, workOrderIds.map((id) => `/work-orders/${id}`)));
  if (workOrderIds.length) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
});

describe("cycle d'alertes : OT au-delà des 50 plus récents", { timeout: 60_000 }, () => {
  it("un OT en retard plus ancien que les 50 derniers créés reçoit son alerte", async () => {
    await alertService.checkWorkOrderAlerts();
    const rows = await db
      .select({ id: alerts.id, title: alerts.title })
      .from(alerts)
      .where(and(eq(alerts.userId, technicianId), eq(alerts.link, `/work-orders/${overdueId}`)));
    expect(rows.map((r) => r.title)).toContain("Ordre de travail en retard");
  });
});
