import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  documentRenewalRequests,
  fuelRecords,
  incidents,
  maintenanceSchedules,
  partRequirements,
  qhseInspections,
  tireInspections,
  tires,
  vehicleDocuments,
  vehicles,
  vehicleTires,
  workOrderItems,
  workOrders,
} from "../../shared/schema";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../../server/lib/idempotency-config";
import { VEHICLE_RETIRED_EDIT_MESSAGE } from "../../server/lib/vehicle-retired";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * L3 (option A, décision 0a) : toute écriture rattachée à un véhicule retiré est refusée en 409
 * (`VEHICLE_RETIRED_EDIT_MESSAGE`), sans ligne créée ni modifiée. Saisie tardive : restaurer, saisir,
 * retirer. Garde `retiredVehicleWriteGuard` (table `RETIRED_VEHICLE_WRITE_ROUTES`), plus
 * `assertVehicleWritable` dans la poignée multipart du renouvellement rapide.
 * Témoins : mêmes écritures acceptées sur un véhicule actif ; client et anonyme gardent leur 401/403 ;
 * le démontage de pneus reste ouvert (récupérer les pneus en stock).
 */
const ids = createIdBag();
const tireIds: number[] = [];
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "workshop" | "tech" | "owner">>>;
const R = { vehicle: 0, wo: 0, schedule: 0, fuel: 0, doc: 0, vt: 0, mileage: 0 };
const A = { vehicle: 0, wo: 0, doc: 0 };
const today = new Date().toISOString().slice(0, 10);

async function seed(vehicleId: number) {
  const fuel = await createTestFuelRecord({ vehicleId, date: today, quantity: 40, cost: "32000" });
  ids.fuelRecordIds.push(fuel.id);
  const [wo] = await db.insert(workOrders).values({ vehicleId, title: "TEST OT L3", status: "pending", priority: "medium" } as any).returning();
  const [schedule] = await db
    .insert(maintenanceSchedules)
    .values({ vehicleId, title: "TEST plan L3", frequency: "monthly", frequencyValue: 1 } as any)
    .returning();
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST assurance L3", type: "assurance", filename: "as.pdf", filesize: 1, fileType: "application/pdf", filePath: "/uploads/documents/TEST-l3.pdf", expiryDate: today } as any)
    .returning();
  const [tire] = await db.insert(tires).values({ brand: uniqueTestToken("pneu"), model: "TEST", size: "315/80R22.5" } as any).returning();
  tireIds.push(tire.id);
  const [vt] = await db
    .insert(vehicleTires)
    .values({ vehicleId, tireId: tire.id, position: "front_left", installationDate: today, installationMileage: 1000, status: "active" } as any)
    .returning();
  return { wo: wo.id, schedule: schedule.id, fuel: fuel.id, doc: doc.id, vt: vt.id };
}

/** Lignes rattachées au véhicule, table par table : un refus n'en crée ni n'en supprime aucune. */
async function footprint(vehicleId: number) {
  const tables = { workOrders, fuelRecords, maintenanceSchedules, vehicleDocuments, incidents, qhseInspections, partRequirements, documentRenewalRequests, vehicleTires };
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table as any).where(eq((table as any).vehicleId, vehicleId));
    out[name] = Number(row.n);
  }
  const vtIds = (await db.select({ id: vehicleTires.id }).from(vehicleTires).where(eq(vehicleTires.vehicleId, vehicleId))).map((r) => r.id);
  const woIds = (await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, vehicleId))).map((r) => r.id);
  out.tireInspections = vtIds.length ? Number((await db.select({ n: count() }).from(tireInspections).where(inArray(tireInspections.vehicleTireId, vtIds)))[0].n) : 0;
  out.workOrderItems = woIds.length ? Number((await db.select({ n: count() }).from(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds)))[0].n) : 0;
  return out;
}

beforeAll(async () => {
  actors = await startContractActors({ admin: "admin", workshop: "workshop_manager", tech: "technician", owner: "client" }, ids.userIds);
  const retired = await createTestVehicle({ ownerId: actors.userIdOf("owner"), mileage: 50000 });
  const active = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  ids.vehicleIds.push(retired.id, active.id);
  Object.assign(R, { vehicle: retired.id, mileage: 50000 }, await seed(retired.id));
  const seededActive = await seed(active.id);
  Object.assign(A, { vehicle: active.id, wo: seededActive.wo, doc: seededActive.doc });
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, retired.id));
}, 180000);

afterAll(async () => {
  try {
    if (ids.vehicleIds.length > 0) {
      const v = ids.vehicleIds;
      const vtIds = (await db.select({ id: vehicleTires.id }).from(vehicleTires).where(inArray(vehicleTires.vehicleId, v))).map((r) => r.id);
      const woIds = (await db.select({ id: workOrders.id }).from(workOrders).where(inArray(workOrders.vehicleId, v))).map((r) => r.id);
      if (vtIds.length) await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, vtIds));
      if (woIds.length) await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds));
      for (const table of [vehicleTires, partRequirements, documentRenewalRequests, incidents, qhseInspections, maintenanceSchedules, vehicleDocuments, workOrders] as any[]) {
        await db.delete(table).where(inArray(table.vehicleId, v));
      }
    }
    if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

type Write = [method: string, url: () => string, body?: () => unknown];

/** Échantillon de la table, une écriture par famille (OT, plan, carburant, kilométrage, documents, pneus, exploitation). */
const WRITES: Write[] = [
  ["POST", () => "/api/work-orders", () => ({ vehicleId: R.vehicle, title: "TEST tardif", priority: "medium" })],
  ["PATCH", () => `/api/work-orders/${R.wo}`, () => ({ title: "TEST modifié" })],
  ["DELETE", () => `/api/work-orders/${R.wo}`],
  ["POST", () => `/api/work-orders/${R.wo}/items`, () => ({ description: "TEST ligne", quantity: 1 })],
  ["POST", () => "/api/maintenance-schedules", () => ({ vehicleId: R.vehicle, title: "TEST plan", frequency: "monthly", frequencyValue: 1 })],
  ["PATCH", () => `/api/maintenance-schedules/${R.schedule}`, () => ({ title: "TEST modifié" })],
  ["DELETE", () => `/api/maintenance-schedules/${R.schedule}`],
  ["POST", () => "/api/fuel-records", () => ({ vehicleId: R.vehicle, date: today, quantity: 10, cost: "8000" })],
  ["PATCH", () => `/api/fuel-records/${R.fuel}`, () => ({ quantity: 12 })],
  ["DELETE", () => `/api/fuel-records/${R.fuel}`],
  ["POST", () => `/api/fuel-records/${R.fuel}/cancel`, () => ({ reason: "TEST annulation tardive" })],
  ["POST", () => `/api/fuel-vouchers/${R.fuel}/validate`, () => ({})],
  ["PUT", () => `/api/vehicles/${R.vehicle}/mileage`, () => ({ mileage: 60000 })],
  ["POST", () => `/api/vehicles/${R.vehicle}/mileage/sync`, () => ({})],
  ["PUT", () => `/api/vehicles/${R.vehicle}/maintenance-position`, () => ({ position: "workshop" })],
  ["PATCH", () => `/api/documents/${R.doc}`, () => ({ name: "TEST modifié" })],
  ["DELETE", () => `/api/documents/${R.doc}`],
  ["POST", () => "/api/document-renewals/requests", () => ({ vehicleId: R.vehicle, vehicleDocumentId: R.doc, comment: "TEST tardif" })],
  ["PATCH", () => `/api/vehicle-tires/${R.vt}`, () => ({ position: "front_right" })],
  ["POST", () => "/api/tire-inspections", () => ({ vehicleTireId: R.vt, inspectionDate: today, treadDepth: "8" })],
  ["POST", () => "/api/part-requirements", () => ({ vehicleId: R.vehicle, workOrderId: R.wo, partName: "TEST", quantity: 1 })],
  ["POST", () => "/api/incidents", () => ({ vehicleId: R.vehicle, title: "TEST incident", type: "breakdown" })],
  ["POST", () => "/api/qhse/inspections", () => ({ vehicleId: R.vehicle, inspectionDate: today })],
];

describe("véhicule retiré : écritures rattachées refusées en 409", { timeout: 60000 }, () => {
  let before: Record<string, number>;
  beforeAll(async () => {
    before = await footprint(R.vehicle);
  });

  it.each(WRITES)("%s %s", async (method, url, body) => {
    const res = await actors.call(method, url(), { actor: "admin", body: body?.() });
    expect(res.status, `${method} ${url()} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(409);
    expect(res.body.message).toBe(VEHICLE_RETIRED_EDIT_MESSAGE);
  });

  it("refus pour tout le personnel, pas seulement l'admin", async () => {
    const created = await actors.call("POST", "/api/work-orders", { actor: "workshop", body: { vehicleId: R.vehicle, title: "TEST", priority: "medium" } });
    expect(created.status).toBe(409);
    const status = await actors.call("PATCH", `/api/technician/work-orders/${R.wo}/status`, { actor: "tech", body: { status: "in_progress" } });
    expect(status.status).toBe(409);
  });

  it("renouvellement rapide (multipart) : refusé par la poignée", async () => {
    const form = new FormData();
    form.append("vehicleId", String(R.vehicle));
    form.append("vehicleDocumentId", String(R.doc));
    form.append("comment", "TEST tardif");
    form.append("newExpiryDate", "2028-01-31");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-justificatif.pdf");
    const res = await fetch(`${actors.baseUrl}/api/document-renewals/quick-renew`, {
      method: "POST",
      headers: { Cookie: actors.cookies.get("admin")! },
      body: form,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe(VEHICLE_RETIRED_EDIT_MESSAGE);
  });

  it("contournements de l'audit : casse, encodage, identifiant converti par la route, urlencoded", async () => {
    const attempts: Array<[string, string, unknown]> = [
      ["PATCH", `/api/Work-Orders/${R.wo}`, { title: "TEST casse" }],
      ["PUT", `/api/vehicles/${encodeURIComponent(String(R.vehicle)).replace(/^\d/, (d) => `%3${d}`)}/mileage`, { mileage: 60000 }],
      ["POST", "/api/fuel-card/consumption", { vehicleId: ` ${R.vehicle}`, date: today, quantity: 1, cost: "1" }],
      ["POST", "/api/fuel-card/consumption", { vehicleId: [R.vehicle], date: today, quantity: 1, cost: "1" }],
      ["POST", "/api/fuel-records", { vehicleId: `${R.vehicle}.0`, date: today, quantity: 1, cost: "1" }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await actors.call(method, url, { actor: "admin", body });
      expect(res.status, `${method} ${url} ${JSON.stringify(body)}`).toBe(409);
    }
    const form = await fetch(`${actors.baseUrl}/api/fuel-records`, {
      method: "POST",
      headers: { Cookie: actors.cookies.get("admin")!, "Content-Type": "application/x-www-form-urlencoded" },
      body: `vehicleId=%2B${R.vehicle}&date=${today}&quantity=1&cost=1`,
    });
    // Le corps urlencoded n'atteint plus la route : refus 415 avant tout effet (anti-CSRF).
    expect(form.status).toBe(415);
  });

  it("aucune ligne créée, modifiée ni supprimée", async () => {
    expect(await footprint(R.vehicle)).toEqual(before);
    const [wo] = await db.select({ title: workOrders.title }).from(workOrders).where(eq(workOrders.id, R.wo));
    expect(wo.title).toBe("TEST OT L3");
    const [vehicle] = await db.select({ mileage: vehicles.mileage, lastMileage: vehicles.lastMileage }).from(vehicles).where(eq(vehicles.id, R.vehicle));
    expect(vehicle).toEqual({ mileage: R.mileage, lastMileage: R.mileage });
  });
});

describe("témoins : le refus ne vise que le véhicule retiré et le personnel", { timeout: 60000 }, () => {
  it("véhicule actif : mêmes écritures acceptées", async () => {
    const wo = await actors.call("PATCH", `/api/work-orders/${A.wo}`, { actor: "admin", body: { title: "TEST actif modifié" } });
    expect(wo.status, JSON.stringify(wo.body).slice(0, 200)).toBeLessThan(300);
    const doc = await actors.call("PATCH", `/api/documents/${A.doc}`, { actor: "admin", body: { name: "TEST actif modifié" } });
    expect(doc.status, JSON.stringify(doc.body).slice(0, 200)).toBeLessThan(300);
    const mileage = await actors.call("PUT", `/api/vehicles/${A.vehicle}/mileage`, { actor: "admin", body: { mileage: 61000 } });
    expect(mileage.status).not.toBe(409);
  });

  it("client et anonyme : la route répond elle-même, comme avant", async () => {
    const client = await actors.call("POST", "/api/fuel-records", { actor: "owner", body: { vehicleId: R.vehicle, date: today, quantity: 1, cost: "1" } });
    expect(client.status).toBe(403);
    const anonymous = await actors.call("POST", "/api/fuel-records", { body: { vehicleId: R.vehicle, date: today, quantity: 1, cost: "1" } });
    expect(anonymous.status).toBe(401);
  });

  it("identifiant hors colonne integer : la route répond elle-même (400 ou 404), jamais 500", async () => {
    const res = await actors.call("POST", "/api/qhse/inspections", { actor: "admin", body: { vehicleId: 3_000_000_000, inspectionDate: today } });
    expect([400, 404]).toContain(res.status);
  });

  it("démontage de pneus laissé ouvert sur véhicule retiré", async () => {
    const res = await actors.call("PATCH", `/api/vehicle-tires/${R.vt}/remove`, { actor: "admin", body: { removalDate: today, removalMileage: 50000, reason: "TEST" } });
    expect(res.status).not.toBe(409);
  });
});

describe("véhicule retiré et idempotence : le refus n'est pas mis en cache", { timeout: 60000 }, () => {
  const previousFlags = process.env.FEATURE_FLAGS;
  beforeAll(() => {
    process.env.FEATURE_FLAGS = "offline-writes=on";
  });
  afterAll(() => {
    if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = previousFlags;
  });

  it("retirer, saisir avec une clé (409), restaurer, rejouer la même clé : 200 et écriture faite", async () => {
    const vehicle = await createTestVehicle({ mileage: 100 });
    ids.vehicleIds.push(vehicle.id);
    await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vehicle.id));
    const key = `l3-${uniqueTestToken("idem")}`;
    const send = () =>
      actors.call("PUT", `/api/vehicles/${vehicle.id}/mileage`, { actor: "admin", body: { kilometers: 1200 }, headers: { [IDEMPOTENCY_HEADER]: key } });

    const refused = await send();
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("VEHICLE_RETIRED");
    expect(refused.body.message).toBe(VEHICLE_RETIRED_EDIT_MESSAGE);

    await db.update(vehicles).set({ deletedAt: null }).where(eq(vehicles.id, vehicle.id));
    const retried = await send();
    expect(retried.status, JSON.stringify(retried.body).slice(0, 200)).toBe(200);
    expect(retried.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
    const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.mileage).toBe(1200);

    // La réponse 200 est, elle, mise en cache : le rejeu suivant la renvoie sans réécrire.
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true");
  });
});
