import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clients } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Niveau C, CLI1 : CRUD client et désactivation.
 * - création : admin, secrétaire, logisticien ; le créateur est la session, jamais le corps ;
 * - un client archivé disparaît de la liste des choix (`GET /api/clients`), reste dans `/all` ;
 * - archivage et restauration sont rejouables sans effet de bord ;
 * - rôle refusé : 403 ; compte client : refusé d'emblée ; corps invalide : 400, jamais 500.
 */

const ACTORS = {
  admin: "admin",
  secretary: "secretary",
  logistics: "logistics",
  warehouse: "warehouse",
  technician: "technician",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const clientIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const call = (...args: Parameters<typeof session.call>) => session.call(...args);

async function createClient(actor: Actor = "admin", overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/clients", {
    actor,
    body: { name: uniqueTestToken("client"), email: `${uniqueTestToken("c")}@client.test`, ...overrides },
  });
  if (res.status === 201) clientIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (clientIds.length > 0) await db.delete(clients).where(inArray(clients.id, clientIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("CLI1 : création", { timeout: 60000 }, () => {
  it.each(["admin", "secretary", "logistics"] as const)("%s crée un client, créateur = la session", async (actor) => {
    const res = await createClient(actor, { createdBy: session.userIdOf("technician") });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(true);
    const [row] = await db.select().from(clients).where(eq(clients.id, res.body.id));
    expect(row.createdBy).toBe(session.userIdOf(actor));
  });

  it.each(["warehouse", "technician"] as const)("%s ne crée pas de client (403)", async (actor) => {
    const before = await db.select().from(clients);
    const res = await createClient(actor);
    expect(res.status).toBe(403);
    expect((await db.select().from(clients)).length).toBe(before.length);
  });

  it("un compte client est refusé", async () => {
    expect((await call("GET", "/api/clients", { actor: "client" })).status).toBe(403);
  });

  it("sans session : 401", async () => {
    expect((await call("GET", "/api/clients")).status).toBe(401);
  });

  it("corps vide ou champ de mauvais type : 400, jamais 500", async () => {
    const empty = await call("POST", "/api/clients", { actor: "admin", body: {} });
    expect(empty.status).toBe(400);
    const wrong = await call("POST", "/api/clients", { actor: "admin", body: { name: 12 } });
    expect(wrong.status).toBe(400);
    expect(leakText(wrong.body)).not.toMatch(/SQLSTATE|violates|stack/);
  });

  it("nom déjà pris : 409", async () => {
    const name = uniqueTestToken("client-dup");
    expect((await createClient("admin", { name })).status).toBe(201);
    expect((await createClient("admin", { name })).status).toBe(409);
  });
});

describe("CLI1 : lecture et modification", { timeout: 60000 }, () => {
  it("détail, id inconnu (404), id non numérique (400)", async () => {
    const created = await createClient();
    const found = await call("GET", `/api/clients/${created.body.id}`, { actor: "warehouse" });
    expect(found.status).toBe(200);
    // Technicien : aucun écran client (moindre donnée, CLIENT_DIRECTORY_READ_ROLES).
    expect((await call("GET", `/api/clients/${created.body.id}`, { actor: "technician" })).status).toBe(403);
    expect(found.body.name).toBe(created.body.name);
    expect((await call("GET", "/api/clients/2147483000", { actor: "admin" })).status).toBe(404);
    expect((await call("GET", "/api/clients/abc", { actor: "admin" })).status).toBe(400);
  });

  it("PATCH modifie un champ ; corps vide : 400 ; id inconnu : 404 ; rôle refusé : 403", async () => {
    const created = await createClient();
    const id = created.body.id;
    const ok = await call("PATCH", `/api/clients/${id}`, { actor: "secretary", body: { phone: "+237600000000" } });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe("+237600000000");
    expect((await call("PATCH", `/api/clients/${id}`, { actor: "admin", body: {} })).status).toBe(400);
    expect((await call("PATCH", "/api/clients/2147483000", { actor: "admin", body: { phone: "1" } })).status).toBe(404);
    expect((await call("PATCH", `/api/clients/${id}`, { actor: "warehouse", body: { phone: "9" } })).status).toBe(403);
    const [row] = await db.select().from(clients).where(eq(clients.id, id));
    expect(row.phone).toBe("+237600000000");
  });

  it("PATCH ne réécrit pas le créateur", async () => {
    const created = await createClient("admin");
    const res = await call("PATCH", `/api/clients/${created.body.id}`, {
      actor: "admin",
      body: { phone: "1", createdBy: session.userIdOf("technician") },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(clients).where(eq(clients.id, created.body.id));
    expect(row.createdBy).toBe(session.userIdOf("admin"));
  });
});

describe("CLI1 : désactivation", { timeout: 60000 }, () => {
  it("un client archivé quitte la liste des choix, reste dans /all, revient à la restauration", async () => {
    const created = await createClient();
    const id = created.body.id;
    const inList = async () => (await call("GET", "/api/clients", { actor: "logistics" })).body.some((c: any) => c.id === id);
    const inAll = async () => (await call("GET", "/api/clients/all", { actor: "admin" })).body.some((c: any) => c.id === id);

    expect(await inList()).toBe(true);
    const archived = await call("DELETE", `/api/clients/${id}`, { actor: "admin" });
    expect(archived.status).toBe(200);
    expect(archived.body.isActive).toBe(false);
    expect(await inList()).toBe(false);
    expect(await inAll()).toBe(true);

    // Rejouable : un second archivage donne le même résultat.
    const again = await call("DELETE", `/api/clients/${id}`, { actor: "admin" });
    expect(again.status).toBe(200);
    expect(again.body.isActive).toBe(false);

    const restored = await call("PATCH", `/api/clients/${id}/restore`, { actor: "secretary" });
    expect(restored.status).toBe(200);
    expect(await inList()).toBe(true);
  });

  it("archivage, restauration et /all refusés au magasinier ; id inconnu : 404", async () => {
    const created = await createClient();
    const id = created.body.id;
    expect((await call("DELETE", `/api/clients/${id}`, { actor: "warehouse" })).status).toBe(403);
    expect((await call("PATCH", `/api/clients/${id}/restore`, { actor: "technician" })).status).toBe(403);
    expect((await call("GET", "/api/clients/all", { actor: "warehouse" })).status).toBe(403);
    expect((await call("DELETE", "/api/clients/2147483000", { actor: "admin" })).status).toBe(404);
    const [row] = await db.select().from(clients).where(eq(clients.id, id));
    expect(row.isActive).toBe(true);
  });
});
