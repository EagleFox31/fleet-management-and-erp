import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, partSpecifications, partVariants, parts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PRT1 : fiche pièce (CRUD, catégorie).
 * - création et modification : admin et magasinier ; suppression : admin seul ;
 * - traçabilité (AGENTS.md §5) : `createdBy` / `updatedBy` viennent de la session, jamais du corps ;
 * - référence unique, corps invalide : 4xx lisible, jamais 500 ni texte d'exception.
 * Variantes et spécifications (`/api/parts/:id/variants|specifications`) : écriture admin et magasinier,
 * lecture de tout le personnel ; enfant d'une autre pièce 404, code de variante dupliqué 409, supplément
 * de prix invalide 400, variante référencée par une demande non supprimable (409).
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

  it("prix non numérique : 400, jamais 500", async () => {
    const res = await createPart("admin", { unitPrice: "beaucoup" });
    expect(res.status).toBe(400);
    noLeak(res);
  });

  it("stock négatif : refusé (400)", async () => {
    const res = await createPart("admin", { quantity: -4 });
    expect(res.status).toBe(400);
  });

  it("référence déjà prise : 409 lisible, sans texte d'exception", async () => {
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

  it("pièce inconnue : 404, pas une 500", async () => {
    const res = await call("DELETE", "/api/parts/2147483000", { actor: "admin" });
    expect(res.status).toBe(404);
    noLeak(res);
  });

  it("pièce déjà supprimée : pas de 500 au second appel", async () => {
    const part = await createTestPart();
    ids.partIds.push(part.id);
    expect((await call("DELETE", `/api/parts/${part.id}`, { actor: "admin" })).status).toBe(204);
    const again = await call("DELETE", `/api/parts/${part.id}`, { actor: "admin" });
    expect(again.status).toBeLessThan(500);
  });
});

const variantBody = (overrides: Record<string, unknown> = {}) => ({
  variantName: "TEST variante",
  variantCode: uniqueTestToken("var"),
  additionalPrice: 250,
  ...overrides,
});

async function newPartId(): Promise<number> {
  const part = await createTestPart();
  ids.partIds.push(part.id);
  return part.id;
}

describe("PRT1 : spécifications d'une pièce", { timeout: 60000 }, () => {
  it.each(["warehouse", "admin"] as const)("%s crée, lit, modifie puis supprime une spécification", async (actor) => {
    const partId = await newPartId();
    const created = await call("POST", `/api/parts/${partId}/specifications`, {
      actor,
      body: { specificationName: uniqueTestToken("diam"), specificationValue: "52", unit: "mm", partId: 999999 },
    });
    expect(created.status).toBe(201);
    expect(created.body.partId).toBe(partId); // partId du corps ignoré

    const list = await call("GET", `/api/parts/${partId}/specifications`, { actor: "technician" });
    expect(list.status).toBe(200);
    expect(list.body.map((s: { id: number }) => s.id)).toEqual([created.body.id]);

    const patched = await call("PATCH", `/api/parts/${partId}/specifications/${created.body.id}`, { actor, body: { specificationValue: "55" } });
    expect(patched.status).toBe(200);
    expect(patched.body.specificationValue).toBe("55");

    expect((await call("DELETE", `/api/parts/${partId}/specifications/${created.body.id}`, { actor })).status).toBe(204);
    expect((await call("DELETE", `/api/parts/${partId}/specifications/${created.body.id}`, { actor })).status).toBe(404);
  });

  it.each(["technician", "workshopManager", "secretary"] as const)("%s ne crée pas de spécification (403)", async (actor) => {
    const partId = await newPartId();
    const res = await call("POST", `/api/parts/${partId}/specifications`, { actor, body: { specificationName: "a", specificationValue: "b" } });
    expect(res.status).toBe(403);
  });

  it("sans session : 401", async () => {
    const partId = await newPartId();
    expect((await call("GET", `/api/parts/${partId}/specifications`, {})).status).toBe(401);
  });

  it("pièce inconnue : 404 en lecture et en création", async () => {
    expect((await call("GET", "/api/parts/2147483000/specifications", { actor: "admin" })).status).toBe(404);
    const res = await call("POST", "/api/parts/2147483000/specifications", { actor: "admin", body: { specificationName: "a", specificationValue: "b" } });
    expect(res.status).toBe(404);
    noLeak(res);
  });

  it("spécification d'une autre pièce : 404, intacte", async () => {
    const [partA, partB] = [await newPartId(), await newPartId()];
    const spec = await call("POST", `/api/parts/${partA}/specifications`, {
      actor: "admin",
      body: { specificationName: uniqueTestToken("s"), specificationValue: "1" },
    });
    expect((await call("PATCH", `/api/parts/${partB}/specifications/${spec.body.id}`, { actor: "admin", body: { specificationValue: "2" } })).status).toBe(404);
    expect((await call("DELETE", `/api/parts/${partB}/specifications/${spec.body.id}`, { actor: "admin" })).status).toBe(404);
    const list = await call("GET", `/api/parts/${partA}/specifications`, { actor: "admin" });
    expect(list.body[0].specificationValue).toBe("1");
  });

  it("nom en double (casse ignorée) : 409 sans fuite ; texte vide : 400 nommé", async () => {
    const partId = await newPartId();
    const name = uniqueTestToken("dup");
    await call("POST", `/api/parts/${partId}/specifications`, { actor: "admin", body: { specificationName: name, specificationValue: "1" } });
    const dup = await call("POST", `/api/parts/${partId}/specifications`, {
      actor: "admin",
      body: { specificationName: name.toUpperCase(), specificationValue: "2" },
    });
    expect(dup.status).toBe(409);
    noLeak(dup);
    const empty = await call("POST", `/api/parts/${partId}/specifications`, { actor: "admin", body: { specificationName: "  ", specificationValue: "2" } });
    expect(empty.status).toBe(400);
    expect(empty.body.errors?.map((e: { field: string }) => e.field)).toContain("specificationName");
  });
});

describe("PRT1 : variantes d'une pièce", { timeout: 60000 }, () => {
  it.each(["warehouse", "admin"] as const)("%s crée, modifie et supprime une variante", async (actor) => {
    const partId = await newPartId();
    const created = await call("POST", `/api/parts/${partId}/variants`, { actor, body: variantBody({ partId: 999999 }) });
    expect(created.status).toBe(201);
    expect(created.body.partId).toBe(partId);
    expect(created.body.additionalPrice).toBe("250.00");

    const list = await call("GET", `/api/parts/${partId}/variants`, { actor: "technician" });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const patched = await call("PATCH", `/api/parts/${partId}/variants/${created.body.id}`, { actor, body: { isAvailable: false } });
    expect(patched.status).toBe(200);
    expect(patched.body.isAvailable).toBe(false);

    expect((await call("DELETE", `/api/parts/${partId}/variants/${created.body.id}`, { actor })).status).toBe(204);
  });

  it.each(["technician", "workshopManager", "secretary"] as const)("%s ne crée pas de variante (403)", async (actor) => {
    const partId = await newPartId();
    expect((await call("POST", `/api/parts/${partId}/variants`, { actor, body: variantBody() })).status).toBe(403);
  });

  it("pièce inconnue : 404 ; variante d'une autre pièce : 404", async () => {
    expect((await call("GET", "/api/parts/2147483000/variants", { actor: "admin" })).status).toBe(404);
    const [partA, partB] = [await newPartId(), await newPartId()];
    const variant = await call("POST", `/api/parts/${partA}/variants`, { actor: "admin", body: variantBody() });
    expect((await call("PATCH", `/api/parts/${partB}/variants/${variant.body.id}`, { actor: "admin", body: { variantName: "x" } })).status).toBe(404);
    expect((await call("DELETE", `/api/parts/${partB}/variants/${variant.body.id}`, { actor: "admin" })).status).toBe(404);
  });

  it("code déjà utilisé (même sur une autre pièce) : 409 sans fuite", async () => {
    const [partA, partB] = [await newPartId(), await newPartId()];
    const body = variantBody();
    expect((await call("POST", `/api/parts/${partA}/variants`, { actor: "admin", body })).status).toBe(201);
    const dup = await call("POST", `/api/parts/${partB}/variants`, { actor: "admin", body });
    expect(dup.status).toBe(409);
    noLeak(dup);
  });

  it.each([["deux"], [-5], ["-1"]])("supplément de prix %j : 400 avec le champ nommé", async (additionalPrice) => {
    const partId = await newPartId();
    const res = await call("POST", `/api/parts/${partId}/variants`, { actor: "admin", body: variantBody({ additionalPrice }) });
    expect(res.status).toBe(400);
    expect(res.body.errors?.map((e: { field: string }) => e.field)).toContain("additionalPrice");
    noLeak(res);
  });

  it("variante utilisée par une demande : suppression refusée (409), variante intacte", async () => {
    const partId = await newPartId();
    const variant = await call("POST", `/api/parts/${partId}/variants`, { actor: "admin", body: variantBody() });
    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId, variantId: variant.body.id, quantityNeeded: 1, reason: "TEST variante" })
      .returning({ id: partRequirements.id });
    try {
      const res = await call("DELETE", `/api/parts/${partId}/variants/${variant.body.id}`, { actor: "admin" });
      expect(res.status).toBe(409);
      noLeak(res);
      expect((await call("GET", `/api/parts/${partId}/variants`, { actor: "admin" })).body).toHaveLength(1);
    } finally {
      await db.delete(partRequirements).where(eq(partRequirements.id, requirement.id));
    }
  });

  it("supprimer la pièce supprime ses spécifications et variantes (cascade)", async () => {
    const partId = await newPartId();
    await call("POST", `/api/parts/${partId}/variants`, { actor: "admin", body: variantBody() });
    await call("POST", `/api/parts/${partId}/specifications`, { actor: "admin", body: { specificationName: "a", specificationValue: "b" } });
    expect((await call("DELETE", `/api/parts/${partId}`, { actor: "admin" })).status).toBe(204);
    expect(await db.select().from(partVariants).where(eq(partVariants.partId, partId))).toHaveLength(0);
    expect(await db.select().from(partSpecifications).where(eq(partSpecifications.partId, partId))).toHaveLength(0);
  });
});
