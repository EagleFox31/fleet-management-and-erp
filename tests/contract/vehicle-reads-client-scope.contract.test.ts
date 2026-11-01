import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison client (AGENTS.md §11) sur les lectures d'un véhicule par id ou par immatriculation :
 * kilométrage, historique kilométrique, historique de statut, pneus, pleins, contrôle d'existence,
 * alertes. Un client ne lit que ses véhicules ; le personnel lit tout ; sans session : 401.
 * Le garde-fou statique `tests/unit/server/vehicle-routes-guard.test.ts` interdit qu'une telle
 * route n'ait que `authenticate`.
 */

const ACTORS = { admin: "admin", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("vrs");
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let own = { id: 0, registrationNumber: "" };
let foreign = { id: 0, registrationNumber: "" };

const BY_ID: Array<(id: number) => string> = [
  (id) => `/api/vehicles/${id}/mileage`,
  (id) => `/api/vehicles/${id}/mileage/history`,
  (id) => `/api/vehicles/${id}/status-history`,
  (id) => `/api/vehicles/${id}/tires`,
  (id) => `/api/fuel-records/vehicle/${id}`,
];

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const a = await createTestVehicle({ registrationNumber: `${token}-own`, ownerId: session.userIdOf("client") });
  const b = await createTestVehicle({ registrationNumber: `${token}-foreign` });
  ids.vehicleIds.push(a.id, b.id);
  own = { id: a.id, registrationNumber: a.registrationNumber };
  foreign = { id: b.id, registrationNumber: b.registrationNumber };
}, 60000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("cloison client sur les lectures d'un véhicule", { timeout: 60000 }, () => {
  it("lecture par id : client sur le sien 200, sur un autre 403, personnel 200, anonyme 401", async () => {
    for (const path of BY_ID) {
      const mine = await session.call("GET", path(own.id), { actor: "client" });
      expect(mine.status, path(own.id)).toBe(200);
      const theirs = await session.call("GET", path(foreign.id), { actor: "client" });
      expect(theirs.status, path(foreign.id)).toBe(403);
      const staff = await session.call("GET", path(foreign.id), { actor: "admin" });
      expect(staff.status, path(foreign.id)).toBe(200);
      expect((await session.call("GET", path(own.id), {})).status, path(own.id)).toBe(401);
    }
  });

  it("GET /api/vehicles/check/:immatriculation : client sur le sien 200, sur un autre 403, personnel 200", async () => {
    const mine = await session.call("GET", `/api/vehicles/check/${own.registrationNumber}`, { actor: "client" });
    expect(mine.status).toBe(200);
    expect(mine.body.exists).toBe(true);
    const theirs = await session.call("GET", `/api/vehicles/check/${foreign.registrationNumber}`, { actor: "client" });
    expect(theirs.status).toBe(403);
    expect(JSON.stringify(theirs.body)).not.toContain(String(foreign.id));
    const staff = await session.call("GET", `/api/vehicles/check/${foreign.registrationNumber}`, { actor: "admin" });
    expect(staff.status).toBe(200);
    expect(staff.body.id).toBe(foreign.id);
    expect((await session.call("GET", `/api/vehicles/check/${own.registrationNumber}`, {})).status).toBe(401);
  });

  it("GET /api/vehicles/check-alerts : le client ne voit que des alertes de ses véhicules", async () => {
    const res = await session.call("GET", "/api/vehicles/check-alerts", { actor: "client" });
    // Aujourd'hui masquée par GET /api/vehicles/:id (404) : le garde de la route reste posé au cas où
    // elle serait remontée devant `:id`.
    expect([200, 403, 404]).toContain(res.status);
    if (res.status === 200) {
      const list: any[] = Array.isArray(res.body) ? res.body : res.body?.alerts ?? [];
      expect(list.some((a) => a.vehicleId === foreign.id)).toBe(false);
    }
    expect((await session.call("GET", "/api/vehicles/check-alerts", {})).status).toBe(401);
  });
});
