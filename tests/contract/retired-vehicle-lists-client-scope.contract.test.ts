import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { tires, vehicleDocuments, vehicles, vehicleTires, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { DOCUMENT_RENEWAL_VIEWER_ROLES } from "../../shared/constants/roles";

/**
 * L1c : listes et agrégats rattachés au véhicule, même règle que le détail et les sous-ressources.
 * Un client ne voit en liste que ses véhicules non retirés (`clientVehicleScope`) ; le personnel voit
 * tout, retiré compris. Exception documentée (AGENTS.md §11) : les OT restent lisibles en liste.
 * Le même acteur parcourt chaque liste ouverte au client : aucune ne renvoie le véhicule retiré,
 * ni le véhicule actif d'un autre client.
 */
const ids = createIdBag();
const tireIds: number[] = [];
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "owner" | "stranger">>>;
const v = { active: 0, retired: 0, theirs: 0 };
const today = new Date();
const dayOffset = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function seed(vehicleId: number) {
  const fuel = await createTestFuelRecord({ vehicleId, date: dayOffset(0), quantity: 40, cost: "32000" });
  ids.fuelRecordIds.push(fuel.id);
  await db.insert(workOrders).values({ vehicleId, title: "TEST OT liste", status: "completed", priority: "medium" } as any);
  await db.insert(vehicleDocuments).values([
    { vehicleId, name: "TEST carte grise", type: "carte_grise", filename: "cg.pdf", filesize: 1, fileType: "application/pdf", filePath: "/uploads/documents/TEST-cg.pdf", expiryDate: dayOffset(-3) },
    { vehicleId, name: "TEST assurance", type: "assurance", filename: "as.pdf", filesize: 1, fileType: "application/pdf", filePath: "/uploads/documents/TEST-as.pdf", expiryDate: dayOffset(10) },
  ] as any);
  const [tire] = await db.insert(tires).values({ brand: uniqueTestToken("pneu"), model: "TEST", size: "315/80R22.5" } as any).returning();
  tireIds.push(tire.id);
  await db.insert(vehicleTires).values({ vehicleId, tireId: tire.id, position: "front_left", installationDate: dayOffset(-30), installationMileage: 1000, status: "active" } as any);
}

/** Véhicules visibles dans une réponse : objets portant une immatriculation, et tout champ `vehicleId`. */
function vehicleIdsIn(body: unknown, found = new Set<number>()): Set<number> {
  if (Array.isArray(body)) body.forEach((item) => vehicleIdsIn(item, found));
  else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.vehicleId === "number") found.add(obj.vehicleId);
    if ("registrationNumber" in obj && typeof obj.id === "number") found.add(obj.id);
    Object.values(obj).forEach((value) => vehicleIdsIn(value, found));
  }
  return found;
}

beforeAll(async () => {
  actors = await startContractActors({ admin: "admin", owner: "client", stranger: "client" }, ids.userIds);
  const a = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  const r = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  const s = await createTestVehicle({ ownerId: actors.userIdOf("stranger") });
  ids.vehicleIds.push(a.id, r.id, s.id);
  Object.assign(v, { active: a.id, retired: r.id, theirs: s.id });
  for (const id of [a.id, r.id, s.id]) await seed(id);
  await db.update(vehicles).set({ status: "operational" }).where(inArray(vehicles.id, [a.id, r.id, s.id]));
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, r.id));
}, 180000);

afterAll(async () => {
  try {
    if (ids.vehicleIds.length > 0) {
      await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
      await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
      await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
    }
    if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

/** Listes ouvertes au client qui exposent un véhicule ; `seeded` : le véhicule actif y figure forcément. */
const LISTS: Array<[string, boolean]> = [
  ["/api/vehicles/all-with-status", true],
  ["/api/vehicles/expired-docs", true],
  ["/api/vehicles/expiring-docs?days=30", true],
  ["/api/vehicles/documents/all", true],
  ["/api/vehicles/check-alerts", true],
  ["/api/vehicle-tires", true],
  ["/api/vehicles/all", true],
  ["/api/vehicles", true],
  ["/api/maintenance-schedules", false],
  ["/api/fuel-records", true],
  ["/api/fuel-records/statistics?period=month", true],
  ["/api/fuel-records/consumption-history?period=month", false],
];

describe("listes rattachées au véhicule : véhicule retiré invisible à son client", { timeout: 60000 }, () => {
  it.each(LISTS)("%s", async (url, seeded) => {
    const res = await actors.call("GET", url, { actor: "owner" });
    expect(res.status, `${url} ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    const seen = vehicleIdsIn(res.body);
    expect(seen.has(v.retired), `${url} : véhicule retiré`).toBe(false);
    expect(seen.has(v.theirs), `${url} : véhicule actif d'un autre client`).toBe(false);
    if (seeded) expect(seen.has(v.active), `${url} : véhicule actif du client`).toBe(true);
  });

  it("agrégats : ne comptent que le véhicule actif du client", async () => {
    const stats = await actors.call("GET", "/api/vehicles/document-stats", { actor: "owner" });
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ total: 1, expiredCarteGrise: 1, expiringAssurance: 1 });

    const fleet = await actors.call("GET", "/api/statistics/fleet", { actor: "owner" });
    expect(fleet.status).toBe(200);
    expect(fleet.body.operational + fleet.body.maintenance + fleet.body.outOfService).toBe(1);

    const compliance = await actors.call("GET", "/api/statistics/maintenance-compliance", { actor: "owner" });
    expect(compliance.status).toBe(200);
    expect(compliance.body.total).toBe(1);
  });

  it("documents/all : chemin disque retiré pour le client, conservé pour le personnel, retiré compris", async () => {
    const mine = await actors.call("GET", "/api/vehicles/documents/all", { actor: "owner" });
    const mineDocs = mine.body.filter((d: any) => d.vehicleId === v.active);
    expect(mineDocs.length).toBe(2);
    for (const doc of mineDocs) {
      expect(doc).not.toHaveProperty("filePath");
      expect(doc).toMatchObject({ filename: expect.any(String), expiryStatus: expect.any(String) });
    }

    const staff = await actors.call("GET", "/api/vehicles/documents/all", { actor: "admin" });
    const staffDocs = staff.body.filter((d: any) => d.vehicleId === v.retired);
    expect(staffDocs.length).toBe(2);
    expect(staffDocs[0].filePath).toMatch(/^\/uploads\/documents\//);
  });

  it("personnel : les listes gardent le véhicule retiré là où elles le montraient", async () => {
    for (const url of ["/api/vehicles/documents/all", "/api/vehicle-tires"]) {
      const res = await actors.call("GET", url, { actor: "admin" });
      expect(res.status, url).toBe(200);
      expect(vehicleIdsIn(res.body).has(v.retired), url).toBe(true);
    }
    const all = await actors.call("GET", "/api/vehicles/all-with-status", { actor: "admin" });
    expect(vehicleIdsIn(all.body).has(v.retired)).toBe(true);
  });

  it("exception documentée : la liste des OT garde ceux du véhicule retiré, jamais ceux d'un autre client", async () => {
    const res = await actors.call("GET", "/api/work-orders?limit=100", { actor: "owner" });
    expect(res.status).toBe(200);
    const seen = vehicleIdsIn(res.body);
    expect(seen.has(v.retired)).toBe(true);
    expect(seen.has(v.active)).toBe(true);
    expect(seen.has(v.theirs)).toBe(false);
  });

  it("justificatif de renouvellement (B7) : refusé au client par le rôle, la cloison véhicule reste en réserve", async () => {
    // Si `client` devient lecteur, la garde véhicule de /requests/:id/proof prend effet :
    // écrire alors son contrat (propriétaire, tiers, véhicule retiré) avant d'ouvrir la route.
    expect(DOCUMENT_RENEWAL_VIEWER_ROLES as readonly string[]).not.toContain("client");
    const res = await actors.call("GET", "/api/document-renewals/requests/1/proof", { actor: "owner" });
    expect(res.status).toBe(403);
  });
});
