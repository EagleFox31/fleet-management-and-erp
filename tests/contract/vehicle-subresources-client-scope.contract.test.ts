import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicles } from "../../shared/schema";
import { OUT_OF_SCOPE_MESSAGE } from "../../server/lib/client-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/**
 * Sous-ressources d'un véhicule (server/api/vehicle-subresources.routes.ts), même cloison que le détail :
 * - client propriétaire : 200 sur son véhicule actif, 403 une fois le véhicule retiré ;
 * - client tiers : 403, même message que le propriétaire d'un véhicule retiré (le retrait ne se devine pas) ;
 * - personnel : 200, véhicule retiré compris ; sans session : 401.
 * Témoins : le montage du routeur ne masque ni /check/:reg ni /documents/all.
 */
const ids = createIdBag();
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician" | "owner" | "stranger">>>;
let active = 0;
let retired = 0;
let retiredRegistration = "";

const PATHS: Array<(id: number) => string> = [
  (id) => `/api/vehicles/${id}/documents`,
  (id) => `/api/vehicles/${id}/documents/assurance`,
  (id) => `/api/vehicles/${id}/mileage`,
  (id) => `/api/vehicles/${id}/mileage/history`,
  (id) => `/api/vehicles/${id}/status-history`,
  (id) => `/api/vehicles/${id}/tires`,
];

beforeAll(async () => {
  actors = await startContractActors(
    { admin: "admin", technician: "technician", owner: "client", stranger: "client" },
    ids.userIds,
  );
  const a = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  const r = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  ids.vehicleIds.push(a.id, r.id);
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, r.id));
  active = a.id;
  retired = r.id;
  retiredRegistration = r.registrationNumber;
}, 180000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

describe("sous-ressources d'un véhicule : cloison client", { timeout: 60000 }, () => {
  it.each(PATHS.map((p) => [p(0).replace("/0/", "/:id/"), p] as const))("%s", async (_label, path) => {
    const mine = await actors.call("GET", path(active), { actor: "owner" });
    expect(mine.status, `${path(active)} ${JSON.stringify(mine.body)}`).toBe(200);

    const mineRetired = await actors.call("GET", path(retired), { actor: "owner" });
    expect(mineRetired.status, path(retired)).toBe(403);
    expect(mineRetired.body.message).toBe(OUT_OF_SCOPE_MESSAGE);

    for (const id of [active, retired]) {
      const theirs = await actors.call("GET", path(id), { actor: "stranger" });
      expect(theirs.status, path(id)).toBe(403);
      expect(theirs.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
    }

    for (const actor of ["admin", "technician"] as const) {
      const staff = await actors.call("GET", path(retired), { actor });
      expect(staff.status, `${actor} ${path(retired)} ${JSON.stringify(staff.body)}`).toBe(200);
    }

    expect((await actors.call("GET", path(active), {})).status, path(active)).toBe(401);
  });

  it("id invalide : 400 avant toute cloison, type de document inconnu : 400", async () => {
    expect((await actors.call("GET", "/api/vehicles/12abc/documents", { actor: "owner" })).status).toBe(400);
    expect((await actors.call("GET", `/api/vehicles/${active}/documents/inconnu`, { actor: "owner" })).status).toBe(400);
  });
});

describe("montage du routeur : routes littérales voisines intactes", { timeout: 60000 }, () => {
  it("GET /api/vehicles/check/:reg répond toujours (personnel : retired)", async () => {
    const res = await actors.call("GET", `/api/vehicles/check/${encodeURIComponent(retiredRegistration)}`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: true, id: retired, retired: true });
  });

  it.each(["documents", "tires", "mileage", "status-history"])("GET /api/vehicles/check/%s reste le contrôle d'immatriculation", async (word) => {
    const res = await actors.call("GET", `/api/vehicles/check/${word}`, { actor: "admin" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveProperty("exists");
  });

  it("historique kilométrique : limit hors bornes ramenée dans [1, 500], pas de 500", async () => {
    for (const limit of ["-5", "0", "999999"]) {
      const res = await actors.call("GET", `/api/vehicles/${active}/mileage/history?limit=${limit}`, { actor: "admin" });
      expect(res.status, `${limit} ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it("GET /api/vehicles/documents/all répond toujours (liste)", async () => {
    const res = await actors.call("GET", "/api/vehicles/documents/all", { actor: "owner" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body) || Array.isArray(res.body?.items) || Array.isArray(res.body?.data)).toBe(true);
  });
});
