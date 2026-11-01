import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Garde-fou de la cloison client (AGENTS.md §11) sur chaque liste de véhicules.
 * Un client ne voit que ses véhicules (`vehicles.ownerId`) ; le personnel les voit tous.
 * Toute nouvelle liste `/api/vehicles*` doit être ajoutée à LISTS : le défaut s'est
 * déjà répété (GET /api/vehicles, 87c8678, cf585de).
 */

const ACTORS = { admin: "admin", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("vcs");
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let ownVehicleId = 0;
let foreignVehicleId = 0;

/** Chemin et extraction des ids de véhicule d'une réponse. */
const LISTS: Array<{ path: string; idsOf: (body: any) => number[] }> = [
  { path: "/api/vehicles?limit=1000", idsOf: (b) => b.vehicles.map((v: any) => v.id) },
  { path: "/api/vehicles/all", idsOf: (b) => b.map((v: any) => v.id) },
  { path: "/api/vehicles/all-with-status", idsOf: (b) => b.map((v: any) => v.id ?? v.vehicleId) },
];

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const own = await createTestVehicle({ registrationNumber: `${token}-own`, ownerId: session.userIdOf("client") });
  const foreign = await createTestVehicle({ registrationNumber: `${token}-foreign` });
  ids.vehicleIds.push(own.id, foreign.id);
  ownVehicleId = own.id;
  foreignVehicleId = foreign.id;
}, 60000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("cloison client sur les listes de véhicules", { timeout: 60000 }, () => {
  it.each(LISTS)("$path : le client ne voit que son véhicule", async ({ path, idsOf }) => {
    const res = await session.call("GET", path, { actor: "client" });
    expect(res.status).toBe(200);
    const seen = idsOf(res.body);
    expect(seen).toContain(ownVehicleId);
    expect(seen).not.toContain(foreignVehicleId);
  });

  it.each(LISTS)("$path : le personnel voit les deux", async ({ path, idsOf }) => {
    const res = await session.call("GET", path, { actor: "admin" });
    expect(res.status).toBe(200);
    const seen = idsOf(res.body);
    expect(seen).toContain(ownVehicleId);
    expect(seen).toContain(foreignVehicleId);
  });

  it("GET /api/vehicles : le total du client ne compte que ses véhicules", async () => {
    const res = await session.call("GET", `/api/vehicles?search=${token}`, { actor: "client" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.vehicles.map((v: any) => v.id)).toEqual([ownVehicleId]);
  });

  it.each(LISTS)("$path : sans session, refusé (401)", async ({ path }) => {
    expect((await session.call("GET", path, { actor: null })).status).toBe(401);
  });
});
