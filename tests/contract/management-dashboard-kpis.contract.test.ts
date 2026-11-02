import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords, workOrders } from "../../shared/schema";
import { toIsoDateOnly } from "@shared/constants/management-dashboard";
import { createTestSupplier, createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * DIR1 : les KPI de `GET /api/management/dashboard` sont recalculés à chaque lecture.
 * Chaque test lit le tableau de bord, joue une vraie transition par l'API, relit, et
 * vérifie la différence (la base est partagée : aucune valeur absolue).
 */

type Actor = "admin" | "management" | "workshop_manager" | "technician" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const workOrderIds: number[] = [];
const fuelRecordIds: number[] = [];
const dayAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const TODAY = () => toIsoDateOnly(new Date());

async function dashboard(period = "month") {
  const res = await session.call("GET", `/api/management/dashboard?period=${period}`, { actor: "management" });
  expect(res.status).toBe(200);
  return res.body;
}

async function newVehicle() {
  const vehicle = await createTestVehicle();
  session.ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    management: "management",
    workshop_manager: "workshop_manager",
    technician: "technician",
    client: "client",
  });
}, 60000);

afterAll(async () => {
  if (fuelRecordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, fuelRecordIds));
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await session.stop();
});

describe("DIR1 : accès au tableau de bord Direction", { timeout: 60000 }, () => {
  it("sans session 401 ; chef d'atelier, technicien, client 403", async () => {
    expect((await session.call("GET", "/api/management/dashboard", { actor: null })).status).toBe(401);
    for (const actor of ["workshop_manager", "technician", "client"] as const) {
      expect((await session.call("GET", "/api/management/dashboard", { actor })).status).toBe(403);
    }
  });

  it("administrateur et direction : 200 ; période inconnue ramenée au mois", async () => {
    expect((await session.call("GET", "/api/management/dashboard", { actor: "admin" })).status).toBe(200);
    const res = await session.call("GET", "/api/management/dashboard?period=n-importe-quoi", { actor: "management" });
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("month");
  });

  it("flotte : total = opérationnels + maintenance + hors service", async () => {
    const d = await dashboard();
    expect(d.fleet.total).toBe(d.fleet.operational + d.fleet.maintenance + d.fleet.outOfService);
  });
});

describe("DIR1 : transition d'un ordre de travail", { timeout: 60000 }, () => {
  it("OT en cours depuis 3 jours : immobilisation +1 ; une fois terminé : retombe, terminé +1, coût atelier + coût", async () => {
    const vehicle = await newVehicle();
    const before = await dashboard();

    const [wo] = await db
      .insert(workOrders)
      .values({
        vehicleId: vehicle.id,
        title: uniqueTestToken("OT-DIR1"),
        status: "in_progress",
        startDate: dayAgo(3),
        cost: "80000",
      })
      .returning();
    workOrderIds.push(wo.id);

    const during = await dashboard();
    expect(during.executiveKpis.vehiclesImmobilizedOver48h - before.executiveKpis.vehiclesImmobilizedOver48h).toBe(1);
    expect(during.alerts.vehiclesImmobilizedOver48h - before.alerts.vehiclesImmobilizedOver48h).toBe(1);
    expect(during.executiveKpis.downtime.completedWorkOrders).toBe(before.executiveKpis.downtime.completedWorkOrders);
    expect(during.executiveKpis.cpkMaintenance.maintenanceHT).toBe(before.executiveKpis.cpkMaintenance.maintenanceHT);

    const patch = await session.call("PATCH", `/api/work-orders/${wo.id}`, { actor: "admin", body: { status: "completed" } });
    expect(patch.status).toBe(200);

    const after = await dashboard();
    expect(after.executiveKpis.vehiclesImmobilizedOver48h).toBe(before.executiveKpis.vehiclesImmobilizedOver48h);
    expect(after.executiveKpis.downtime.completedWorkOrders - before.executiveKpis.downtime.completedWorkOrders).toBe(1);
    expect(after.executiveKpis.cpkMaintenance.maintenanceHT - before.executiveKpis.cpkMaintenance.maintenanceHT).toBe(80000);
    expect(after.executiveKpis.downtime.totalImmobilizationHours - before.executiveKpis.downtime.totalImmobilizationHours).toBeGreaterThanOrEqual(71.9);
    expect(after.executiveKpis.prk.directChargesHT - before.executiveKpis.prk.directChargesHT).toBe(80000);
  });

  it("OT annulé : n'entre ni dans les OT terminés ni dans le coût atelier", async () => {
    const vehicle = await newVehicle();
    const before = await dashboard();
    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: uniqueTestToken("OT-DIR1"), status: "pending", cost: "55000" })
      .returning();
    workOrderIds.push(wo.id);
    const patch = await session.call("PATCH", `/api/work-orders/${wo.id}`, { actor: "admin", body: { status: "cancelled" } });
    expect(patch.status).toBe(200);
    const after = await dashboard();
    expect(after.executiveKpis.downtime.completedWorkOrders).toBe(before.executiveKpis.downtime.completedWorkOrders);
    expect(after.executiveKpis.cpkMaintenance.maintenanceHT).toBe(before.executiveKpis.cpkMaintenance.maintenanceHT);
  });
});

describe("DIR1 : transition de statut d'un véhicule", { timeout: 60000 }, () => {
  it("opérationnel -> maintenance -> hors service : les compteurs de flotte suivent, le total est stable", async () => {
    const vehicle = await newVehicle();
    const base = await dashboard();

    const toMaintenance = await session.call("PATCH", `/api/vehicles/${vehicle.id}`, { actor: "admin", body: { status: "maintenance" } });
    expect(toMaintenance.status).toBe(200);
    const m = await dashboard();
    expect(m.fleet.maintenance - base.fleet.maintenance).toBe(1);
    expect(m.fleet.operational - base.fleet.operational).toBe(-1);
    expect(m.fleet.total).toBe(base.fleet.total);

    const toOut = await session.call("PATCH", `/api/vehicles/${vehicle.id}`, { actor: "admin", body: { status: "out_of_service" } });
    expect(toOut.status).toBe(200);
    const o = await dashboard();
    expect(o.fleet.outOfService - base.fleet.outOfService).toBe(1);
    expect(o.fleet.maintenance - base.fleet.maintenance).toBe(0);
    expect(o.alerts.outOfServiceVehicles - base.alerts.outOfServiceVehicles).toBe(1);
    expect(o.fleet.total).toBe(base.fleet.total);
  });
});

describe("DIR1 : saisie puis suppression d'un plein", { timeout: 60000 }, () => {
  it("le plein ajoute son coût aux charges directes ; sa suppression le retire", async () => {
    const vehicle = await newVehicle();
    const before = await dashboard();

    const created = await session.call("POST", "/api/fuel-records", {
      actor: "admin",
      body: { vehicleId: vehicle.id, date: TODAY(), quantity: 30, cost: 24000, mileage: 1000, notes: uniqueTestToken("fuel") },
    });
    expect(created.status).toBe(201);
    fuelRecordIds.push(created.body.id);

    const during = await dashboard();
    expect(during.executiveKpis.prk.directChargesHT - before.executiveKpis.prk.directChargesHT).toBe(24000);

    const removed = await session.call("DELETE", `/api/fuel-records/${created.body.id}`, { actor: "admin" });
    expect(removed.status).toBe(204);
    const after = await dashboard();
    expect(after.executiveKpis.prk.directChargesHT).toBe(before.executiveKpis.prk.directChargesHT);
  });
});

describe("DIR1 : facture fournisseur", { timeout: 60000 }, () => {
  it("saisie : charges fournisseurs + HT une seule fois", async () => {
    const supplier = await createTestSupplier();
    session.ids.supplierIds.push(supplier.id);
    const before = await dashboard();
    const res = await session.call("POST", "/api/supplier-invoices", {
      actor: "admin",
      body: { supplierId: supplier.id, invoiceDate: TODAY(), invoiceNumber: uniqueTestToken("FAC"), amountHT: 40000 },
    });
    expect(res.status).toBe(201);
    session.ids.invoiceIds.push(res.body.invoice.id);

    const after = await dashboard();
    expect(after.expenses.suppliers - before.expenses.suppliers).toBe(40000);
    expect(after.executiveKpis.prk.directChargesHT - before.executiveKpis.prk.directChargesHT).toBe(40000);
  });
});
