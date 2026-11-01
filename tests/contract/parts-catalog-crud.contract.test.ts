import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PRT1 : fiche pièce (CRUD, catégorie).
 * - création et modification : admin et magasinier ; suppression : admin seul ;
 * - traçabilité (AGENTS.md §5) : `createdBy` / `updatedBy` viennent de la session, jamais du corps ;
 * - référence unique, corps invalide : 4xx lisible, jamais 500 ni texte d'exception.
 * Les variantes et spécifications (`part_variants`, `part_specifications`) n'ont aucune route
 * ni méthode de stockage : rien à tester au contrat tant qu'elles ne sont pas exposées.
 */

const ACTORS = {
  admin: "admin",
  warehouse: "warehouse",
  technician: "technician",
  workshopManager: "workshop_manager",
  secretary: "secretary",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

const partBody = (overrides: Record<string, unknown> = {}) => ({
  name: "TEST pièce catalogue",
  reference: uniqueTestToken("ref"),
  category: "Filtres",
  quantity: 10,
  minQuantity: 5,
  unitPrice: "1500",
  ...overrides,
});

async function createPart(actor: Actor = "warehouse", overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/parts", { actor, body: partBody(overrides) });
  if (res.status === 201) ids.partIds.push(res.body.id);
  return res;
}

const rowOf = async (id: number) => (await db.select().from(parts).where(eq(parts.id, id)))[0];
const noLeak = (res: { body: any }) => expect(JSON.stringify(res.body)).not.toMatch(/SQLSTATE|violates|duplicate key|invalid input syntax|at \S+:\d+/);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("PRT1 : création", { timeout: 60000 }, () => {
  it.each(["admin", "warehouse"] as const)("%s crée une pièce ; créateur = la session, jamais le corps", async (actor) => {
    const res = await createPart(actor, { createdBy: session.userIdOf("technician"), updatedBy: session.userIdOf("technician") });
    expect(res.status).toBe(201);
    const saved = await rowOf(res.body.id);
    expect(saved.createdBy).toBe(session.userIdOf(actor));
    expect(saved.updatedBy).toBe(session.userIdOf(actor));
    expect(saved.category).toBe("Filtres");
  });

  it("alerte de réapprovisionnement posée quand le stock est au seuil", async () => {
    const low = await createPart("admin", { quantity: 2, minQuantity: 5 });
    expect((await rowOf(low.body.id)).reorderAlert).toBe(true);
    const ok = await createPart("admin", { quantity: 20, minQuantity: 5 });
    expect((await rowOf(ok.body.id)).reorderAlert).toBe(false);
  });

  it.each(["technician", "workshopManager", "secretary"] as const)("%s ne crée pas de pièce (403)", async (actor) => {
    const body = partBody();
    const res = await call("POST", "/api/parts", { actor, body });
    expect(res.status).toBe(403);
    expect(await db.select().from(parts).where(eq(parts.reference, body.reference))).toHaveLength(0);
  });

  it("corps vide, nom manquant, quantité mal typée, unité inconnue : 400 sans fuite", async () => {
    for (const body of [{}, { reference: uniqueTestToken("ref") }, partBody({ quantity: "dix" }), partBody({ unit: "tonneau" })]) {
      const res = await call("POST", "/api/parts", { actor: "admin", body });
      expect(res.status).toBe(400);
      noLeak(res);
    }
  });

  it.fails("prix non numérique : 400, jamais 500", async () => {
    const res = await createPart("admin", { unitPrice: "beaucoup" });
    expect(res.status).toBe(400);
    noLeak(res);
  });

  it.fails("stock négatif : refusé (400)", async () => {
    const res = await createPart("admin", { quantity: -4 });
    expect(res.status).toBe(400);
  });

  it.fails("référence déjà prise : 409 lisible, sans texte d'exception", async () => {
    const first = await createPart("admin");
    const again = await call("POST", "/api/parts", { actor: "admin", body: partBody({ reference: first.body.reference }) });
    expect(again.status).toBe(409);
    noLeak(again);
  });
});

describe("PRT1 : lecture", { timeout: 60000 }, () => {
  it("recherche par référence : la pièce est trouvée ; recherche sans résultat : liste vide", async () => {
    const created = await createPart("admin");
    const found = await call("GET", `/api/parts?search=${encodeURIComponent(created.body.reference)}`, { actor: "technician" });
    expect(found.status).toBe(200);
    expect(found.body.parts.map((p: any) => p.id)).toContain(created.body.id);
    const none = await call("GET", `/api/parts?search=${encodeURIComponent(uniqueTestToken("absent"))}`, { actor: "technician" });
    expect(none.status).toBe(200);
    expect(none.body.parts).toEqual([]);
    expect(none.body.total).toBe(0);
  });

  it("détail ; id inconnu : 404", async () => {
    const created = await createPart("admin");
    const detail = await call("GET", `/api/parts/${created.body.id}`, { actor: "workshopManager" });
    expect(detail.status).toBe(200);
    expect(detail.body.reference).toBe(created.body.reference);
    expect((await call("GET", "/api/parts/2147483000", { actor: "admin" })).status).toBe(404);
  });

  it("sans session : 401", async () => {
    expect((await call("GET", "/api/parts")).status).toBe(401);
  });
});

describe("PRT1 : modification", { timeout: 60000 }, () => {
  it("changer la catégorie ; updatedBy = la session, createdBy intact, champs d'audit du corps ignorés", async () => {
    const created = await createPart("admin");
    const res = await call("PATCH", `/api/parts/${created.body.id}`, {
      actor: "warehouse",
      body: { category: "Freinage", createdBy: session.userIdOf("technician"), updatedBy: session.userIdOf("technician") },
    });
    expect(res.status).toBe(200);
    const saved = await rowOf(created.body.id);
    expect(saved.category).toBe("Freinage");
    expect(saved.createdBy).toBe(session.userIdOf("admin"));
    expect(saved.updatedBy).toBe(session.userIdOf("warehouse"));
  });

  it("rôle refusé : 403, rien ne change", async () => {
    const created = await createPart("admin");
    const res = await call("PATCH", `/api/parts/${created.body.id}`, { actor: "technician", body: { category: "Autre" } });
    expect(res.status).toBe(403);
    expect((await rowOf(created.body.id)).category).toBe("Filtres");
  });

  it("id inconnu : 404 ; référence d'une autre pièce : 409 ; unité inconnue : 400", async () => {
    const a = await createPart("admin");
    const b = await createPart("admin");
    expect((await call("PATCH", "/api/parts/2147483000", { actor: "admin", body: { category: "X" } })).status).toBe(404);
    const dup = await call("PATCH", `/api/parts/${b.body.id}`, { actor: "admin", body: { reference: a.body.reference } });
    expect(dup.status).toBe(409);
    noLeak(dup);
    expect((await call("PATCH", `/api/parts/${b.body.id}`, { actor: "admin", body: { unit: "tonneau" } })).status).toBe(400);
  });

  it("deux modifications identiques donnent le même état", async () => {
    const created = await createPart("admin");
    const patch = () => call("PATCH", `/api/parts/${created.body.id}`, { actor: "admin", body: { category: "Freinage", location: "TEST-A1" } });
    expect((await patch()).status).toBe(200);
    expect((await patch()).status).toBe(200);
    const saved = await rowOf(created.body.id);
    expect([saved.category, saved.location]).toEqual(["Freinage", "TEST-A1"]);
  });
});

describe("PRT1 : suppression", { timeout: 60000 }, () => {
  it("admin supprime (204) ; la pièce n'existe plus", async () => {
    const created = await createPart("admin");
    expect((await call("DELETE", `/api/parts/${created.body.id}`, { actor: "admin" })).status).toBe(204);
    expect(await rowOf(created.body.id)).toBeUndefined();
  });

  it.each(["warehouse", "technician"] as const)("%s ne supprime pas (403)", async (actor) => {
    const created = await createPart("admin");
    expect((await call("DELETE", `/api/parts/${created.body.id}`, { actor })).status).toBe(403);
    expect(await rowOf(created.body.id)).toBeDefined();
  });

  it.fails("pièce inconnue : 404, pas une 500", async () => {
    const res = await call("DELETE", "/api/parts/2147483000", { actor: "admin" });
    expect(res.status).toBe(404);
    noLeak(res);
  });

  it.fails("pièce déjà supprimée : pas de 500 au second appel", async () => {
    const part = await createTestPart();
    ids.partIds.push(part.id);
    expect((await call("DELETE", `/api/parts/${part.id}`, { actor: "admin" })).status).toBe(204);
    const again = await call("DELETE", `/api/parts/${part.id}`, { actor: "admin" });
    expect(again.status).toBeLessThan(500);
  });
});
