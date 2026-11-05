import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, vehicleDocuments, vehicles, workOrders } from "../../shared/schema";
import { OUT_OF_SCOPE_MESSAGE } from "../../server/lib/client-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";

/**
 * L1b : lectures rattachées à un véhicule, même cloison que les sous-ressources
 * (`assertVehicleSubresourcesReadable`) :
 * - client propriétaire : 200 sur son véhicule actif, 403 une fois le véhicule retiré ;
 * - client tiers : 403, même message ; personnel : 200, véhicule retiré compris ; sans session : 401.
 * Par chemin (`/work-orders/vehicle/:id`, `/maintenance-schedules/vehicle/:id`, `/fuel-records/vehicle/:id`)
 * comme par filtre (`/fuel-records?vehicleId=`, `/fuel-records/consumption-history?vehicleId=`).
 * Near miss de L1 : la route en chemin était fermée, le filtre de requête restait ouvert. Le balayage
 * « toutes les routes de pleins » joue le même acteur sur chaque entrée qui expose un plein.
 */
const ids = createIdBag();
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician" | "owner" | "stranger">>>;
let active = 0;
let retired = 0;
const docIds: Record<"active" | "retired", number> = { active: 0, retired: 0 };
const today = new Date().toISOString().slice(0, 10);

const READS: Array<[string, (id: number) => string]> = [
  ["/api/work-orders/vehicle/:id", (id) => `/api/work-orders/vehicle/${id}`],
  ["/api/maintenance-schedules/vehicle/:id", (id) => `/api/maintenance-schedules/vehicle/${id}`],
  ["/api/fuel-records/vehicle/:id", (id) => `/api/fuel-records/vehicle/${id}`],
  ["/api/fuel-records?vehicleId=", (id) => `/api/fuel-records?vehicleId=${id}`],
  ["/api/fuel-records/consumption-history?vehicleId=", (id) => `/api/fuel-records/consumption-history?vehicleId=${id}`],
];

async function seed(vehicleId: number) {
  const fuel = await createTestFuelRecord({ vehicleId, date: today, quantity: 40, cost: "32000" });
  ids.fuelRecordIds.push(fuel.id);
  await db.insert(workOrders).values({ vehicleId, title: "TEST OT historique", status: "completed", priority: "medium" } as any);
  await db.insert(maintenanceSchedules).values({ vehicleId, title: "TEST plan historique", frequency: "km", frequencyValue: 10000, isActive: true } as any);
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST doc", type: "autre", filename: "absent.pdf", filesize: 1, fileType: "application/pdf", filePath: "/uploads/documents/TEST-absent.pdf" })
    .returning({ id: vehicleDocuments.id });
  return doc.id;
}

beforeAll(async () => {
  actors = await startContractActors(
    { admin: "admin", technician: "technician", owner: "client", stranger: "client" },
    ids.userIds,
  );
  const a = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  const r = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  ids.vehicleIds.push(a.id, r.id);
  active = a.id;
  retired = r.id;
  docIds.active = await seed(active);
  docIds.retired = await seed(retired);
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, retired));
}, 180000);

afterAll(async () => {
  try {
    if (ids.vehicleIds.length > 0) {
      await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, ids.vehicleIds));
      await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
      await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
    }
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

describe("lectures rattachées au véhicule : cloison client, retrait compris", { timeout: 60000 }, () => {
  it.each(READS)("%s", async (_label, path) => {
    const mine = await actors.call("GET", path(active), { actor: "owner" });
    expect(mine.status, `${path(active)} ${JSON.stringify(mine.body)}`).toBe(200);
    expect(Array.isArray(mine.body) && mine.body.length > 0, path(active)).toBe(true);

    const mineRetired = await actors.call("GET", path(retired), { actor: "owner" });
    expect(mineRetired.status, path(retired)).toBe(403);
    expect(mineRetired.body.message).toBe(OUT_OF_SCOPE_MESSAGE);

    for (const id of [active, retired]) {
      const theirs = await actors.call("GET", path(id), { actor: "stranger" });
      expect(theirs.status, `stranger ${path(id)}`).toBe(403);
      expect(theirs.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
    }

    for (const actor of ["admin", "technician"] as const) {
      const staff = await actors.call("GET", path(retired), { actor });
      expect(staff.status, `${actor} ${path(retired)} ${JSON.stringify(staff.body)}`).toBe(200);
      expect(Array.isArray(staff.body) && staff.body.length > 0, `${actor} ${path(retired)}`).toBe(true);
    }

    expect((await actors.call("GET", path(active), {})).status, path(active)).toBe(401);
  });

  it("id illisible : 400 par chemin comme par filtre", async () => {
    for (const path of READS.map(([, p]) => p)) {
      const url = path(0).replace(/0$/, "12abc");
      expect((await actors.call("GET", url, { actor: "owner" })).status, url).toBe(400);
    }
  });
});

describe("near miss L1 : un même acteur sur chaque entrée qui expose un plein", { timeout: 60000 }, () => {
  it("propriétaire d'un véhicule retiré : aucun plein de ce véhicule, ni par chemin, ni par filtre, ni par agrégat", async () => {
    for (const url of [
      `/api/fuel-records/vehicle/${retired}`,
      `/api/fuel-records?vehicleId=${retired}`,
      `/api/fuel-records/consumption-history?vehicleId=${retired}`,
    ]) {
      expect((await actors.call("GET", url, { actor: "owner" })).status, url).toBe(403);
    }

    const list = await actors.call("GET", "/api/fuel-records", { actor: "owner" });
    expect(list.status).toBe(200);
    expect(list.body.map((r: any) => r.vehicleId)).not.toContain(retired);
    expect(list.body.map((r: any) => r.vehicleId)).toContain(active);

    // B6 : l'agrégat d'un client ne porte que sur ses véhicules non retirés.
    const stats = await actors.call("GET", "/api/fuel-records/statistics?period=month", { actor: "owner" });
    expect(stats.status).toBe(200);
    expect(stats.body.vehicleStats.map((v: any) => v.vehicleId)).toEqual([active]);
    expect(stats.body.totalFuel).toBe(40);

    const history = await actors.call("GET", "/api/fuel-records/consumption-history?period=month", { actor: "owner" });
    expect(history.status).toBe(200);
    expect(history.body.reduce((sum: number, p: any) => sum + p.quantity, 0)).toBe(40);

    // Période inconnue, nom de clé héritée compris : repli sur le mois, jamais 500.
    for (const period of ["constructor", "__proto__", "toString", "inconnue"]) {
      const res = await actors.call("GET", `/api/fuel-records/consumption-history?period=${period}`, { actor: "owner" });
      expect(res.status, period).toBe(200);
      expect(res.body.reduce((sum: number, p: any) => sum + p.quantity, 0), period).toBe(40);
    }
  });
});

describe("fichiers rattachés à un véhicule retiré (B5)", { timeout: 60000 }, () => {
  it("téléchargement d'un document : 403 au propriétaire une fois le véhicule retiré, pas au personnel", async () => {
    const retiredDoc = await actors.call("GET", `/api/documents/${docIds.retired}/download`, { actor: "owner" });
    expect(retiredDoc.status).toBe(403);
    expect(retiredDoc.body.message).toBe(OUT_OF_SCOPE_MESSAGE);

    // Fichier absent du disque : au-delà de la cloison, la réponse est 404, jamais 403.
    expect((await actors.call("GET", `/api/documents/${docIds.active}/download`, { actor: "owner" })).status).toBe(404);
    expect((await actors.call("GET", `/api/documents/${docIds.retired}/download`, { actor: "admin" })).status).toBe(404);
    expect((await actors.call("GET", `/api/documents/${docIds.active}/download`, { actor: "stranger" })).status).toBe(403);
  });
});
