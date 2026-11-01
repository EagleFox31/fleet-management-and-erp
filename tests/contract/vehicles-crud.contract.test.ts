import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { statusHistory, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, VEH1 : fiche véhicule.
 * - création et modification : admin et chef d'atelier ; suppression : admin seul ;
 * - immatriculation unique (refus lisible, jamais 500) ; `createdBy` pris de la session ;
 * - statut initial consigné dans `status_history` ;
 * - `GET /api/vehicles/check/:immatriculation` : existe ou non.
 */

const ACTORS = {
  admin: "admin",
  workshopManager: "workshop_manager",
  technician: "technician",
  warehouse: "warehouse",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
const rowOf = async (id: number) => (await db.select().from(vehicles).where(eq(vehicles.id, id)))[0];

const plate = () => uniqueTestToken("veh").slice(0, 30);
const validBody = (registrationNumber = plate()) => ({
  registrationNumber,
  brand: "Renault",
  model: "T480",
  year: 2021,
  mileage: 12000,
  vehicleType: "porteur",
  fuelType: "diesel",
  status: "operational",
});

// POST brut : tout 201 inattendu est enregistré pour le ménage.
async function post(actor: Actor | undefined, body: unknown) {
  const res = await call("POST", "/api/vehicles", actor ? { actor, body } : { body });
  if (res.status === 201) ids.vehicleIds.push(res.body.id);
  return res;
}

async function create(actor: Actor = "workshopManager", registrationNumber = plate()) {
  const res = await call("POST", "/api/vehicles", { actor, body: validBody(registrationNumber) });
  if (res.status === 201) ids.vehicleIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("VEH1 : création", { timeout: 180000 }, () => {
  // Mise en place hors des it.fails : un échec de création ne doit pas passer pour le défaut attendu.
  let historyVehicleId: number;
  beforeAll(async () => {
    const res = await create("workshopManager");
    expect(res.status).toBe(201);
    historyVehicleId = res.body.id;
  });

  it.each(["admin", "workshopManager"] as const)("%s crée un véhicule : createdBy = session", async (actor) => {
    const res = await create(actor);
    expect(res.status).toBe(201);
    expect(res.body.createdBy).toBe(session.userIdOf(actor));
    expect((await rowOf(res.body.id)).createdBy).toBe(session.userIdOf(actor));
  });

  it("le statut initial est consigné dans l'historique", async () => {
    const history = await db.select().from(statusHistory).where(eq(statusHistory.vehicleId, historyVehicleId));
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.every((h) => h.status === "operational")).toBe(true);
  });

  // DEFAUT PRODUIT : la création consigne le statut deux fois. `storage.createVehicle`
  // (server/storage.ts:871) insère déjà la ligne, puis `POST /api/vehicles`
  // (server/routes.ts:1092-1093) appelle `recordStatusChange` : deux lignes identiques,
  // l'historique d'un véhicule neuf compte un changement qui n'a pas eu lieu.
  it.fails("le statut initial n'est consigné qu'une fois", async () => {
    const history = await db.select().from(statusHistory).where(eq(statusHistory.vehicleId, historyVehicleId));
    expect(history.length).toBe(1);
  });

  it("createdBy envoyé dans le corps est ignoré", async () => {
    const res = await call("POST", "/api/vehicles", {
      actor: "workshopManager",
      body: { ...validBody(), createdBy: session.userIdOf("admin") },
    });
    expect(res.status).toBe(201);
    ids.vehicleIds.push(res.body.id);
    expect(res.body.createdBy).toBe(session.userIdOf("workshopManager"));
  });

  it.each(["technician", "warehouse"] as const)("%s : création refusée (403)", async (actor) => {
    const res = await post(actor, validBody());
    expect(res.status).toBe(403);
  });

  it("sans session : 401", async () => {
    const res = await post(undefined, validBody());
    expect(res.status).toBe(401);
  });

  it("immatriculation déjà utilisée : refus lisible, un seul véhicule", async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const again = await post("workshopManager", validBody(first.body.registrationNumber));
    expect(again.status).toBe(400);
    expect(again.body.message).toBeTruthy();
  });

  it.each([
    ["corps vide", () => ({})],
    ["marque absente", () => ({ ...validBody(), brand: undefined })],
  ])("%s : 400, jamais 500", async (_label, makeBody) => {
    const res = await post("workshopManager", makeBody());
    expect(res.status).toBe(400);
  });

  // DEFAUT PRODUIT : `year` et `mileage` passent par `Number(val)` (shared/schema.ts:154-155) :
  // "abc" donne NaN, la validation Zod l'accepte et l'insertion échoue en base : 500 au lieu de 400.
  it.fails.each([
    ["année mal typée", () => ({ ...validBody(), year: "abc" })],
    ["kilométrage mal typé", () => ({ ...validBody(), mileage: "x" })],
  ])("%s : 400, jamais 500", async (_label, makeBody) => {
    const res = await post("workshopManager", makeBody());
    expect(res.status).toBe(400);
  });
});

describe("VEH1 : lecture et unicité", { timeout: 180000 }, () => {
  it("check/:immatriculation : existe, puis n'existe pas", async () => {
    const created = await create();
    const known = await call("GET", `/api/vehicles/check/${created.body.registrationNumber}`, { actor: "technician" });
    expect(known.status).toBe(200);
    expect(known.body).toMatchObject({ exists: true, id: created.body.id });
    const unknown = await call("GET", `/api/vehicles/check/${plate()}`, { actor: "technician" });
    expect(unknown.body).toEqual({ exists: false });
  });

  it("détail : id inconnu 404, valeur non numérique cherchée comme immatriculation 404", async () => {
    expect((await call("GET", "/api/vehicles/999999999", { actor: "technician" })).status).toBe(404);
    // Une valeur non numérique est cherchée comme immatriculation (server/routes.ts:1052-1060) : 404, et non 400.
    expect((await call("GET", "/api/vehicles/abc", { actor: "technician" })).status).toBe(404);
  });

  it("le véhicule créé apparaît dans la liste", async () => {
    const created = await create();
    const list = await call("GET", "/api/vehicles", { actor: "technician" });
    expect(list.status).toBe(200);
    const items = Array.isArray(list.body) ? list.body : list.body.items ?? list.body.vehicles ?? [];
    expect(items.some((v: any) => v.id === created.body.id)).toBe(true);
  });
});

describe("VEH1 : modification et suppression", { timeout: 180000 }, () => {
  // Mise en place des it.fails : créée ici, hors du test qui porte le défaut.
  let taken: any;
  let renamed: any;
  let authored: any;
  beforeAll(async () => {
    taken = (await create()).body;
    renamed = (await create()).body;
    authored = (await create("workshopManager")).body;
    for (const v of [taken, renamed, authored]) expect(v?.id).toBeTruthy();
  });

  it("le chef d'atelier modifie les notes ; le technicien est refusé", async () => {
    const created = await create();
    const ok = await call("PATCH", `/api/vehicles/${created.body.id}`, { actor: "workshopManager", body: { notes: "Rouge" } });
    expect(ok.status).toBe(200);
    expect((await rowOf(created.body.id)).notes).toBe("Rouge");
    const refused = await call("PATCH", `/api/vehicles/${created.body.id}`, { actor: "technician", body: { notes: "Bleu" } });
    expect(refused.status).toBe(403);
    expect((await rowOf(created.body.id)).notes).toBe("Rouge");
  });

  it("PATCH : id inconnu 404, non numérique 400, type invalide 400", async () => {
    const created = await create();
    expect((await call("PATCH", "/api/vehicles/999999999", { actor: "admin", body: { notes: "x" } })).status).toBe(404);
    expect((await call("PATCH", "/api/vehicles/abc", { actor: "admin", body: { notes: "x" } })).status).toBe(400);
    const bad = await call("PATCH", `/api/vehicles/${created.body.id}`, { actor: "admin", body: { year: "abc" } });
    expect(bad.status).toBe(400);
  });

  it("PATCH rejoué à l'identique : même résultat", async () => {
    const created = await create();
    const a = await call("PATCH", `/api/vehicles/${created.body.id}`, { actor: "admin", body: { notes: "Vert" } });
    const b = await call("PATCH", `/api/vehicles/${created.body.id}`, { actor: "admin", body: { notes: "Vert" } });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await rowOf(created.body.id)).notes).toBe("Vert");
  });

  // DEFAUT PRODUIT : la violation d'unicité est avalée par `storage.updateVehicle`
  // (server/storage.ts:910, rend undefined), puis `PATCH /api/vehicles/:id`
  // (server/routes.ts:1201) répond 500 « Erreur serveur » au lieu d'un refus lisible 4xx.
  it.fails("PATCH : l'immatriculation d'un autre véhicule est refusée (4xx, pas 500)", async () => {
    const res = await call("PATCH", `/api/vehicles/${renamed.id}`, {
      actor: "admin",
      body: { registrationNumber: taken.registrationNumber },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // DEFAUT PRODUIT : `PATCH /api/vehicles/:id` (server/routes.ts:1193) passe le corps brut à
  // `prepareColumnUpdate`, qui accepte toute colonne : `createdBy` envoyé par le client
  // réécrit l'auteur de la fiche (AGENTS.md §5 : ces champs ne viennent jamais du corps).
  it.fails("PATCH : createdBy du corps ne réécrit pas l'auteur", async () => {
    await call("PATCH", `/api/vehicles/${authored.id}`, {
      actor: "admin",
      body: { notes: "Noir", createdBy: session.userIdOf("technician") },
    });
    expect((await rowOf(authored.id)).createdBy).toBe(session.userIdOf("workshopManager"));
  });

  it("suppression : refusée au chef d'atelier ; id inconnu 404 pour l'admin", async () => {
    const created = await create();
    expect((await call("DELETE", `/api/vehicles/${created.body.id}`, { actor: "workshopManager" })).status).toBe(403);
    expect(await rowOf(created.body.id)).toBeTruthy();
    expect((await call("DELETE", "/api/vehicles/999999999", { actor: "admin" })).status).toBe(404);
  });
});
