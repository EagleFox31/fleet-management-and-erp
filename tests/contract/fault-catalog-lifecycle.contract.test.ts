import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { faultCatalog } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, CAT2 : catalogue de pannes, cycle `draft -> validated -> archived`.
 * - création et modification : chef d'atelier et admin ; suppression : admin seul ;
 * - un statut hors énumération est refusé (400) ; un champ de traçabilité (`createdBy`,
 *   `validatedBy`) ne se forge pas par le corps ;
 * - pièces associées : `fault_catalog_parts` n'a ni route ni méthode de stockage, rien à
 *   tester au contrat tant qu'elle n'est pas exposée.
 */

const ACTORS = {
  admin: "admin",
  workshopManager: "workshop_manager",
  technician: "technician",
  warehouse: "warehouse",
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
