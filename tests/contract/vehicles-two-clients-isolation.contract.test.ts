import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison client (AGENTS.md §11) sur les trois lectures de véhicule restées en `authenticate`
 * avec garde dans le handler (liste gelée de `tests/unit/server/vehicle-routes-guard.test.ts`) :
 * GET /api/vehicles, GET /api/vehicles/all, GET /api/vehicles/:id.
 *
 * Deux clients distincts + un membre du personnel : A ne voit ni ne lit le véhicule de B (et
 * réciproquement), 403 sur l'objet isolé, le personnel voit tout, sans session 401.
 * `vehicles-lists-client-scope` ne joue qu'un client ; ici le croisement A/B ferme le cas
 * « le filtre exclut tout le monde sauf le personnel » et « le client voit le véhicule d'un autre client ».
 */

const ACTORS = { admin: "admin", clientA: "client", clientB: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("v2c");
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let a = { id: 0, plate: "" };
let b = { id: 0, plate: "" };
let staffOwned = { id: 0, plate: "" };

const vehicleIds = (body: any): number[] => body.vehicles.map((v: any) => v.id);

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const va = await createTestVehicle({ registrationNumber: `${token}-a`, ownerId: session.userIdOf("clientA") });
  const vb = await createTestVehicle({ registrationNumber: `${token}-b`, ownerId: session.userIdOf("clientB") });
  const vs = await createTestVehicle({ registrationNumber: `${token}-s` });
  ids.vehicleIds.push(va.id, vb.id, vs.id);
  a = { id: va.id, plate: va.registrationNumber };
  b = { id: vb.id, plate: vb.registrationNumber };
  staffOwned = { id: vs.id, plate: vs.registrationNumber };
}, 60000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("cloison entre deux clients : lectures de véhicule", { timeout: 60000 }, () => {
  it("GET /api/vehicles : chaque client ne voit que le sien, total compris", async () => {
    const forA = await session.call("GET", `/api/vehicles?search=${token}&limit=100`, { actor: "clientA" });
    const forB = await session.call("GET", `/api/vehicles?search=${token}&limit=100`, { actor: "clientB" });
    expect(forA.status).toBe(200);
    expect(forB.status).toBe(200);
    expect(vehicleIds(forA.body)).toEqual([a.id]);
    expect(forA.body.total).toBe(1);
    expect(vehicleIds(forB.body)).toEqual([b.id]);
    expect(forB.body.total).toBe(1);
  });

  it("GET /api/vehicles : chercher la plaque d'un autre client ne le révèle pas", async () => {
    const res = await session.call("GET", `/api/vehicles?search=${b.plate}`, { actor: "clientA" });
    expect(res.status).toBe(200);
    expect(vehicleIds(res.body)).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("GET /api/vehicles : le personnel voit les véhicules des deux clients et celui sans propriétaire", async () => {
    const res = await session.call("GET", `/api/vehicles?search=${token}&limit=100`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(vehicleIds(res.body).sort()).toEqual([a.id, b.id, staffOwned.id].sort());
    expect(res.body.total).toBe(3);
  });

  it("GET /api/vehicles/all : ni A ni B ne voient le véhicule de l'autre ni celui sans propriétaire ; le personnel voit tout", async () => {
    const forA = await session.call("GET", "/api/vehicles/all", { actor: "clientA" });
    const forB = await session.call("GET", "/api/vehicles/all", { actor: "clientB" });
    const staff = await session.call("GET", "/api/vehicles/all", { actor: "admin" });
    const seenA = forA.body.map((v: any) => v.id);
    const seenB = forB.body.map((v: any) => v.id);
    const seenStaff = staff.body.map((v: any) => v.id);
    expect(forA.status).toBe(200);
    expect(seenA).toContain(a.id);
    expect(seenA).not.toContain(b.id);
    expect(seenA).not.toContain(staffOwned.id);
    expect(seenB).toContain(b.id);
    expect(seenB).not.toContain(a.id);
    expect(seenB).not.toContain(staffOwned.id);
    expect(seenStaff).toEqual(expect.arrayContaining([a.id, b.id, staffOwned.id]));
  });

  it("GET /api/vehicles/:id par id : le sien 200, celui d'un autre client 403, personnel 200, sans session 401", async () => {
    expect((await session.call("GET", `/api/vehicles/${a.id}`, { actor: "clientA" })).status).toBe(200);
    expect((await session.call("GET", `/api/vehicles/${b.id}`, { actor: "clientB" })).status).toBe(200);
    const aOnB = await session.call("GET", `/api/vehicles/${b.id}`, { actor: "clientA" });
    const bOnA = await session.call("GET", `/api/vehicles/${a.id}`, { actor: "clientB" });
    expect(aOnB.status).toBe(403);
    expect(bOnA.status).toBe(403);
    // Le refus ne divulgue rien du véhicule.
    expect(JSON.stringify(aOnB.body)).not.toContain(b.plate);
    expect(JSON.stringify(bOnA.body)).not.toContain(a.plate);
    for (const v of [a, b, staffOwned]) {
      const res = await session.call("GET", `/api/vehicles/${v.id}`, { actor: "admin" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(v.id);
    }
    expect((await session.call("GET", `/api/vehicles/${a.id}`, {})).status).toBe(401);
  });

  it("GET /api/vehicles/:id : un véhicule sans propriétaire n'est lisible par aucun client", async () => {
    expect((await session.call("GET", `/api/vehicles/${staffOwned.id}`, { actor: "clientA" })).status).toBe(403);
    expect((await session.call("GET", `/api/vehicles/${staffOwned.id}`, { actor: "clientB" })).status).toBe(403);
  });

  it("GET /api/vehicles/:id par immatriculation : même cloison que par id", async () => {
    expect((await session.call("GET", `/api/vehicles/${a.plate}`, { actor: "clientA" })).status).toBe(200);
    expect((await session.call("GET", `/api/vehicles/${b.plate}`, { actor: "clientA" })).status).toBe(403);
    expect((await session.call("GET", `/api/vehicles/${a.plate}`, { actor: "clientB" })).status).toBe(403);
    expect((await session.call("GET", `/api/vehicles/${b.plate}`, { actor: "admin" })).status).toBe(200);
  });

  it("GET /api/vehicles/:id : identifiant inconnu, 404 (jamais 500) pour un client comme pour le personnel", async () => {
    for (const actor of ["clientA", "admin"] as const) {
      expect((await session.call("GET", `/api/vehicles/${token}-inconnu`, { actor })).status).toBe(404);
      expect((await session.call("GET", "/api/vehicles/2147483000", { actor })).status).toBe(404);
    }
  });
});
