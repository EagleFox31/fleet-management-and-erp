import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders, workshopLaborRates } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * WO5 : taux horaire en vigueur pour un OT (`GET /api/work-orders/:id/labor-rate`).
 *
 * L'écran et le PDF de l'OT s'en servent pour appliquer la règle du KPI de coût. La liste des
 * taux reste admin ; cette route ne sert qu'un taux, au personnel. Un client n'y a pas accès.
 */

type Actor = "technician" | "warehouse" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const workOrderIds: number[] = [];
const rateIds: number[] = [];

beforeAll(async () => {
  session = await startContractSession<Actor>({ technician: "technician", warehouse: "warehouse", client: "client" });
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  if (rateIds.length > 0) await db.delete(workshopLaborRates).where(inArray(workshopLaborRates.id, rateIds));
  await session.stop();
});

describe("WO5 : taux horaire d'un OT", { timeout: 60000 }, () => {
  it("sert le taux en vigueur à la clôture de l'OT, au personnel seulement", async () => {
    // Date d'effet propre à ce test (contrainte unique, base partagée).
    const [rate] = await db
      .insert(workshopLaborRates)
      .values({ effectiveFrom: "2016-03-01", hourlyRateHt: "6500" })
      .returning();
    rateIds.push(rate.id);
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const [wo] = await db
      .insert(workOrders)
      .values({
        vehicleId: vehicle.id,
        title: "TEST-wo5-rate",
        status: "completed",
        startDate: new Date("2016-03-09T08:00:00Z"),
        endDate: new Date("2016-03-10T16:00:00Z"),
      })
      .returning();
    workOrderIds.push(wo.id);
    const path = `/api/work-orders/${wo.id}/labor-rate`;

    expect((await session.call("GET", path, { actor: null })).status).toBe(401);
    expect((await session.call("GET", path, { actor: "client" })).status).toBe(403);
    // Le chauffeur est du personnel mais ne voit pas les coûts d'atelier (WORK_ORDER_COST_READ_ROLES).
    expect((await session.call("GET", path, { actor: "driver" })).status).toBe(403);

    for (const actor of ["technician", "warehouse"] as const) {
      const res = await session.call("GET", path, { actor });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ effectiveFrom: "2016-03-01", hourlyRateHt: 6500 });
    }
  });

  it("aucun taux avant la date de l'OT : null, pas d'erreur", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const [wo] = await db
      .insert(workOrders)
      .values({
        vehicleId: vehicle.id,
        title: "TEST-wo5-norate",
        status: "completed",
        startDate: new Date("2001-01-09T08:00:00Z"),
        endDate: new Date("2001-01-10T16:00:00Z"),
      })
      .returning();
    workOrderIds.push(wo.id);

    const res = await session.call("GET", `/api/work-orders/${wo.id}/labor-rate`, { actor: "technician" });
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("identifiant non entier : 400 au contrat d'erreur", async () => {
    const res = await session.call("GET", "/api/work-orders/abc/labor-rate", { actor: "technician" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it("identifiant au-delà d'un integer Postgres : 400, pas 500", async () => {
    const res = await session.call("GET", "/api/work-orders/99999999999/labor-rate", { actor: "technician" });
    expect(res.status).toBe(400);
  });

  it("OT inexistant : 404, distinct de « aucun taux » (null)", async () => {
    const res = await session.call("GET", "/api/work-orders/2147483647/labor-rate", { actor: "technician" });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });
});
