import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { faultCatalog, faultCatalogParts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Niveau C, CAT2 : catalogue de pannes, cycle `draft -> validated -> archived`.
 * - création et modification : chef d'atelier et admin ; suppression : admin seul ;
 * - un statut hors énumération est refusé (400) ; un champ de traçabilité (`createdBy`,
 *   `validatedBy`) ne se forge pas par le corps ;
 * - pièces associées (`/api/fault-catalog/:id/parts`) : écriture admin et chef d'atelier, lecture du
 *   personnel ; doublon 409, panne archivée figée (409), suppression d'une panne en cascade ; suppression d'une pièce
 *   citée par une panne refusée (409, FK RESTRICT) ; rôle client refusé en lecture.
 */

const ACTORS = {
  admin: "admin",
  workshopManager: "workshop_manager",
  technician: "technician",
  warehouse: "warehouse",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const catalogIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
const rowOf = async (id: number) => (await db.select().from(faultCatalog).where(eq(faultCatalog.id, id)))[0];

async function createFault(actor: Actor = "workshopManager") {
  const res = await call("POST", "/api/fault-catalog", {
    actor,
    body: { name: uniqueTestToken("panne"), description: "TEST description", category: "Moteur", symptoms: ["bruit"] },
  });
  expect(res.status).toBe(201);
  catalogIds.push(res.body.id);
  return res.body.id as number;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (catalogIds.length > 0) await db.delete(faultCatalog).where(inArray(faultCatalog.id, catalogIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("CAT2 : cycle de vie", { timeout: 60000 }, () => {
  it("une panne naît en brouillon, puis validée, puis archivée", async () => {
    const id = await createFault();
    expect((await rowOf(id)).status).toBe("draft");

    const validated = await call("PATCH", `/api/fault-catalog/${id}`, { actor: "workshopManager", body: { status: "validated" } });
    expect(validated.status).toBe(200);
    expect(validated.body.status).toBe("validated");
    expect((await rowOf(id)).status).toBe("validated");

    const archived = await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { status: "archived" } });
    expect(archived.status).toBe(200);
    expect((await rowOf(id)).status).toBe("archived");
  });

  it("l'état est visible dans la liste pour tous les rôles connectés", async () => {
    const id = await createFault();
    await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { status: "validated" } });
    for (const actor of ["technician", "warehouse"] as const) {
      const list = await call("GET", "/api/fault-catalog", { actor });
      expect(list.status).toBe(200);
      expect(list.body.find((c: any) => c.id === id)?.status).toBe("validated");
    }
    expect((await call("GET", "/api/fault-catalog")).status).toBe(401);
  });

  it("rejouer la même transition donne le même état", async () => {
    const id = await createFault();
    for (let i = 0; i < 2; i++) {
      expect((await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { status: "archived" } })).status).toBe(200);
    }
    expect((await rowOf(id)).status).toBe("archived");
  });

  it("un statut hors énumération est refusé (400) et ne change rien", async () => {
    const id = await createFault();
    const res = await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { status: "publie" } });
    expect(res.status).toBe(400);
    expect((await rowOf(id)).status).toBe("draft");
  });

  it("technicien et magasinier ne modifient pas le catalogue (403)", async () => {
    const id = await createFault();
    for (const actor of ["technician", "warehouse"] as const) {
      const res = await call("PATCH", `/api/fault-catalog/${id}`, { actor, body: { status: "validated" } });
      expect(res.status).toBe(403);
    }
    expect((await rowOf(id)).status).toBe("draft");
  });
});

describe("CAT2 : traçabilité", { timeout: 60000 }, () => {
  it("le corps ne réécrit pas le créateur", async () => {
    const id = await createFault("workshopManager");
    const res = await call("PATCH", `/api/fault-catalog/${id}`, {
      actor: "workshopManager",
      body: { description: "TEST modifiée", createdBy: session.userIdOf("technician") },
    });
    expect(res.status).toBe(200);
    expect((await rowOf(id)).createdBy).toBe(session.userIdOf("workshopManager"));
  });

  it("le valideur ne se forge pas par le corps", async () => {
    const id = await createFault();
    await call("PATCH", `/api/fault-catalog/${id}`, {
      actor: "workshopManager",
      body: { status: "validated", validatedBy: session.userIdOf("admin") },
    });
    expect((await rowOf(id)).validatedBy).not.toBe(session.userIdOf("admin"));
  });

  it("valider une panne enregistre qui l'a validée", async () => {
    const id = await createFault();
    await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { status: "validated" } });
    expect((await rowOf(id)).validatedBy).toBe(session.userIdOf("admin"));
  });
});

describe("CAT2 : modification et suppression", { timeout: 60000 }, () => {
  it("id inconnu : 404 (et non un 200 vide)", async () => {
    const res = await call("PATCH", "/api/fault-catalog/2147483000", { actor: "admin", body: { description: "x" } });
    expect(res.status).toBe(404);
  });

  it("id non numérique : 400", async () => {
    expect((await call("PATCH", "/api/fault-catalog/abc", { actor: "admin", body: { description: "x" } })).status).toBe(400);
  });

  it("type invalide sur un nombre : 400 nommé", async () => {
    const id = await createFault();
    const res = await call("PATCH", `/api/fault-catalog/${id}`, { actor: "admin", body: { estimatedDuration: "longtemps" } });
    expect(res.status).toBe(400);
    expect(res.body.errors?.map((e: { field: string }) => e.field)).toContain("estimatedDuration");
  });

  it("suppression : admin seul", async () => {
    const id = await createFault();
    expect((await call("DELETE", `/api/fault-catalog/${id}`, { actor: "workshopManager" })).status).toBe(403);
    expect(await rowOf(id)).toBeDefined();
    expect((await call("DELETE", `/api/fault-catalog/${id}`, { actor: "admin" })).status).toBe(204);
    expect(await rowOf(id)).toBeUndefined();
    // Rejouable.
    expect((await call("DELETE", `/api/fault-catalog/${id}`, { actor: "admin" })).status).toBeLessThan(500);
  });
});

const linksOf = async (faultId: number) => db.select().from(faultCatalogParts).where(eq(faultCatalogParts.faultCatalogId, faultId));

async function newPartId(): Promise<number> {
  const part = await createTestPart();
  ids.partIds.push(part.id);
  return part.id;
}

describe("CAT2 : pièces associées à une panne", { timeout: 60000 }, () => {
  it("le chef d'atelier associe une pièce (201), le personnel la lit avec nom et référence", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    const created = await call("POST", `/api/fault-catalog/${faultId}/parts`, {
      actor: "workshopManager",
      body: { partId, quantity: 2, isOptional: true, faultCatalogId: 999999 },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ faultCatalogId: faultId, partId, quantity: 2, isOptional: true });

    for (const actor of ["technician", "warehouse"] as const) {
      const list = await call("GET", `/api/fault-catalog/${faultId}/parts`, { actor });
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].partName).toBeTruthy();
      expect(list.body[0].partReference).toBeTruthy();
    }
  });

  it("quantité et caractère optionnel par défaut ; modification puis retrait par le chef d'atelier et l'admin", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    const created = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } });
    expect(created.body).toMatchObject({ quantity: 1, isOptional: false });
    const patched = await call("PATCH", `/api/fault-catalog/${faultId}/parts/${created.body.id}`, { actor: "workshopManager", body: { quantity: 4 } });
    expect(patched.status).toBe(200);
    expect(patched.body.quantity).toBe(4);
    expect((await call("DELETE", `/api/fault-catalog/${faultId}/parts/${created.body.id}`, { actor: "workshopManager" })).status).toBe(204);
    expect(await linksOf(faultId)).toHaveLength(0);
    expect((await call("DELETE", `/api/fault-catalog/${faultId}/parts/${created.body.id}`, { actor: "admin" })).status).toBe(404);
  });

  it("pièce hors plage int4 : 400 sur partId, rien d'écrit", async () => {
    const faultId = await createFault();
    const res = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId: 2147483648 } });
    expect(res.status).toBe(400);
    expect((res.body?.errors ?? []).map((error: { field?: string }) => error.field)).toContain("partId");
    expect(await linksOf(faultId)).toHaveLength(0);
  });

  it.each(["technician", "warehouse"] as const)("%s n'écrit pas (403), sans session 401", async (actor) => {
    const faultId = await createFault();
    const partId = await newPartId();
    expect((await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor, body: { partId } })).status).toBe(403);
    expect((await call("GET", `/api/fault-catalog/${faultId}/parts`, {})).status).toBe(401);
    expect(await linksOf(faultId)).toHaveLength(0);
  });

  it("panne inconnue : 404 ; lien d'une autre panne : 404, intact", async () => {
    expect((await call("GET", "/api/fault-catalog/2147483000/parts", { actor: "admin" })).status).toBe(404);
    const partId = await newPartId();
    expect((await call("POST", "/api/fault-catalog/2147483000/parts", { actor: "admin", body: { partId } })).status).toBe(404);

    const [faultA, faultB] = [await createFault(), await createFault()];
    const link = await call("POST", `/api/fault-catalog/${faultA}/parts`, { actor: "admin", body: { partId } });
    expect((await call("PATCH", `/api/fault-catalog/${faultB}/parts/${link.body.id}`, { actor: "admin", body: { quantity: 9 } })).status).toBe(404);
    expect((await call("DELETE", `/api/fault-catalog/${faultB}/parts/${link.body.id}`, { actor: "admin" })).status).toBe(404);
    expect((await linksOf(faultA))[0].quantity).toBe(1);
  });

  it("pièce inconnue : 404 sans fuite SQL", async () => {
    const faultId = await createFault();
    const res = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId: 2147483000 } });
    expect(res.status).toBe(404);
    expect(leakText(res.body)).not.toMatch(/SQLSTATE|violates|foreign key/i);
  });

  it("même pièce deux fois : 409", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    expect((await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } })).status).toBe(201);
    const dup = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } });
    expect(dup.status).toBe(409);
    expect(await linksOf(faultId)).toHaveLength(1);
  });

  it.each([[0], ["deux"], [1.5]])("quantité %j : 400 avec le champ nommé", async (quantity) => {
    const faultId = await createFault();
    const partId = await newPartId();
    const res = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId, quantity } });
    expect(res.status).toBe(400);
    expect(res.body.errors?.map((e: { field: string }) => e.field)).toContain("quantity");
  });

  it("panne archivée : écritures refusées (409), lecture permise ; validée reste modifiable", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    const link = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } });

    await call("PATCH", `/api/fault-catalog/${faultId}`, { actor: "admin", body: { status: "validated" } });
    expect((await call("PATCH", `/api/fault-catalog/${faultId}/parts/${link.body.id}`, { actor: "admin", body: { quantity: 3 } })).status).toBe(200);

    await call("PATCH", `/api/fault-catalog/${faultId}`, { actor: "admin", body: { status: "archived" } });
    const otherPart = await newPartId();
    expect((await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId: otherPart } })).status).toBe(409);
    expect((await call("PATCH", `/api/fault-catalog/${faultId}/parts/${link.body.id}`, { actor: "admin", body: { quantity: 5 } })).status).toBe(409);
    expect((await call("DELETE", `/api/fault-catalog/${faultId}/parts/${link.body.id}`, { actor: "admin" })).status).toBe(409);
    expect((await call("GET", `/api/fault-catalog/${faultId}/parts`, { actor: "technician" })).status).toBe(200);
    expect((await linksOf(faultId))[0].quantity).toBe(3);
  });

  it("l'admin supprime une panne qui a des pièces : 204 et liens supprimés (ex-500)", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } });
    expect((await call("DELETE", `/api/fault-catalog/${faultId}`, { actor: "admin" })).status).toBe(204);
    expect(await linksOf(faultId)).toHaveLength(0);
  });

  it("supprimer une pièce liée à une panne : 409 lisible (ex-500), rien n'est supprimé ; le lien retiré, la suppression passe", async () => {
    const faultId = await createFault();
    const partId = await newPartId();
    const link = await call("POST", `/api/fault-catalog/${faultId}/parts`, { actor: "admin", body: { partId } });
    const refused = await call("DELETE", `/api/parts/${partId}`, { actor: "admin" });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Pièce utilisée dans le catalogue de pannes");
    expect(await linksOf(faultId)).toHaveLength(1);
    expect((await call("GET", `/api/parts/${partId}`, { actor: "admin" })).status).toBe(200);

    expect((await call("DELETE", `/api/fault-catalog/${faultId}/parts/${link.body.id}`, { actor: "admin" })).status).toBe(204);
    expect((await call("DELETE", `/api/parts/${partId}`, { actor: "admin" })).status).toBe(204);
  });

  it("un client ne lit pas les pièces d'une panne (403)", async () => {
    const faultId = await createFault();
    expect((await call("GET", `/api/fault-catalog/${faultId}/parts`, { actor: "client" })).status).toBe(403);
  });

  it("identifiant hors plage d'un integer Postgres : 400 et non 500", async () => {
    const res = await call("GET", "/api/fault-catalog/99999999999/parts", { actor: "technician" });
    expect(res.status).toBe(400);
  });
});
