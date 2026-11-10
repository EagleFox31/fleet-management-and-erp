import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, clientInvoices, fuelRecords, missions, workOrders } from "../../shared/schema";
import { toIsoDateOnly } from "@shared/constants/management-dashboard";
import { createTestSupplier, createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere, deleteClientInvoicesWhere } from "../support/money-override";

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
  if (fuelRecordIds.length > 0) await deleteFuelRecordsWhere(inArray(fuelRecords.id, fuelRecordIds));
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

describe("DIR1 : partage du CA d'une mission à plusieurs affectations (#227)", { timeout: 60000 }, () => {
  it("parts égales entre véhicules distincts ; affectation annulée ou refusée exclue, terminée comptée", async () => {
    // Montant hors d'atteinte des données partagées : les deux véhicules comptés sont en tête de marge.
    const amountHT = 4_000_000_000_000;
    const [relay, done, cancelled, rejected] = [await newVehicle(), await newVehicle(), await newVehicle(), await newVehicle()];
    const [mission] = await db
      .insert(missions)
      .values({
        orderNumber: uniqueTestToken("CA"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        status: "completed",
        deliveryDate: new Date(),
      } as any)
      .returning();
    const rows = await db
      .insert(assignments)
      .values([
        // Relais : deux affectations sur le même camion = un seul véhicule, une seule part.
        { missionId: mission.id, vehicleId: relay.id, status: "accepted" },
        { missionId: mission.id, vehicleId: relay.id, status: "in_progress" },
        { missionId: mission.id, vehicleId: done.id, status: "completed" },
        { missionId: mission.id, vehicleId: cancelled.id, status: "cancelled" },
        { missionId: mission.id, vehicleId: rejected.id, status: "rejected" },
      ] as any)
      .returning({ id: assignments.id });
    const [invoice] = await db
      .insert(clientInvoices)
      .values({
        missionId: mission.id,
        invoiceNumber: uniqueTestToken("inv-ca"),
        invoiceDate: TODAY(),
        dueDate: TODAY(),
        amountHT: String(amountHT),
        amountTTC: String(amountHT),
        balance: String(amountHT),
      })
      .returning({ id: clientInvoices.id });

    try {
      const tco = (await dashboard()).vehicleTco;
      const items = [...tco.topByMargin, ...tco.worstByMargin] as Array<{ vehicleId: number; revenueHT: number; missionCount: number }>;
      const itemOf = (vehicleId: number) => items.find((item) => item.vehicleId === vehicleId);

      expect(itemOf(relay.id)).toMatchObject({ revenueHT: amountHT / 2, missionCount: 1 });
      expect(itemOf(done.id)).toMatchObject({ revenueHT: amountHT / 2, missionCount: 1 });
      expect(itemOf(cancelled.id)).toBeUndefined();
      expect(itemOf(rejected.id)).toBeUndefined();
    } finally {
      await deleteClientInvoicesWhere(eq(clientInvoices.id, invoice.id));
      await db.delete(assignments).where(inArray(assignments.id, rows.map((r) => r.id)));
      await db.delete(missions).where(eq(missions.id, mission.id));
    }
  });
});

describe("GPS-FE-4 : la flotte des corridors n'invente ni position ni statut", { timeout: 60000 }, () => {
  it("véhicule sans mission : jamais en transit, aucune coordonnée ; mission en cours : en transit, toujours sans coordonnée", async () => {
    const idle = await newVehicle();
    const rolling = await newVehicle();
    const [mission] = await db
      .insert(missions)
      .values({
        orderNumber: uniqueTestToken("GPS4"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST Garoua",
        status: "in_progress",
      } as any)
      .returning();
    const [assignment] = await db
      .insert(assignments)
      .values({ missionId: mission.id, vehicleId: rolling.id, status: "in_progress" } as any)
      .returning({ id: assignments.id });
    // Même véhicule : mission planifiée, affectation annulée sur une autre en cours, mission livrée.
    const extra = await db
      .insert(missions)
      .values([
        { orderNumber: uniqueTestToken("GPS4P"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "planned" },
        { orderNumber: uniqueTestToken("GPS4C"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" },
        { orderNumber: uniqueTestToken("GPS4D"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "delivered" },
      ] as any)
      .returning({ id: missions.id });
    const extraAssignments = await db
      .insert(assignments)
      .values([
        { missionId: extra[0].id, vehicleId: rolling.id, status: "accepted" },
        { missionId: extra[1].id, vehicleId: rolling.id, status: "cancelled" },
        { missionId: extra[2].id, vehicleId: rolling.id, status: "in_progress" },
      ] as any)
      .returning({ id: assignments.id });

    try {
      const fleet = (await dashboard()).corridorFleet as Array<Record<string, unknown>>;
      const rowOf = (vehicleId: number) => fleet.find((v) => v.vehicleId === vehicleId)!;

      expect(rowOf(idle.id)).toMatchObject({ transitStatus: "stopped", positionSource: "none" });
      expect(rowOf(rolling.id)).toMatchObject({ transitStatus: "in_transit", positionSource: "none", missionId: mission.id });
      // Planifiée moins avancée, annulée et livrée ignorées : la mission en cours l'emporte.
      // Aucune position réelle n'existe encore : aucun véhicule ne porte de coordonnée.
      for (const row of fleet) {
        expect(row.positionSource).toBe("none");
        expect(row.currentLat).toBeUndefined();
        expect(row.currentLng).toBeUndefined();
      }
    } finally {
      await db.delete(assignments).where(inArray(assignments.id, [assignment.id, ...extraAssignments.map((a) => a.id)]));
      await db.delete(missions).where(inArray(missions.id, [mission.id, ...extra.map((m) => m.id)]));
    }
  });
});
