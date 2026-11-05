import { createServer, request as httpRequest, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { db, pool } from "../../server/db";
import { listActiveAdminIds } from "../../server/lib/last-admin";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Garde du dernier administrateur actif : PATCH /api/users/:id (rôle), DELETE /api/users/:id et
 * DELETE /api/admin/users/:id. Les cas « dernier admin » sont concurrents (deux admins qui se
 * retirent mutuellement) : l'appelant étant lui-même un admin actif, une requête isolée ne peut
 * pas viser le dernier. Ils exigent une base où seuls les deux comptes du test sont admins actifs
 * (sinon ils sont ignorés : on ne touche pas aux comptes des autres sessions).
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function newAdmin() {
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await call("POST", "/api/auth/login", { body: { username: admin.username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return { id: admin.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

const rowOf = async (id: number) =>
  (await db.select({ role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("LAG1 : rôle d'administrateur (PATCH /api/users/:id)", { timeout: 60000 }, () => {
  it("refuse (400) que l'admin retire son propre rôle ; rôle inchangé en base", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const res = await call("PATCH", `/api/users/${a.id}`, { cookie: a.cookie, body: { role: "warehouse" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/votre rôle d'administrateur/);
    expect((await rowOf(a.id)).role).toBe("admin");
    expect((await rowOf(b.id)).role).toBe("admin");
  });

  it("autorise (200) le retrait du rôle d'un autre admin quand un admin actif reste", async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const res = await call("PATCH", `/api/users/${b.id}`, { cookie: a.cookie, body: { role: "warehouse" } });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("warehouse");
    expect((await rowOf(b.id)).role).toBe("warehouse");
    expect((await rowOf(a.id)).role).toBe("admin");
  });

  it("autorise une modification sans changement de rôle (nom) et la confirmation du rôle admin", async () => {
    const a = await newAdmin();
    expect((await call("PATCH", `/api/users/${a.id}`, { cookie: a.cookie, body: { name: "TESTRename" } })).status).toBe(200);
    expect((await call("PATCH", `/api/users/${a.id}`, { cookie: a.cookie, body: { role: "admin" } })).status).toBe(200);
  });

  it("refuse (400) un identifiant mal formé sans toucher la base", async () => {
    const a = await newAdmin();
    const res = await call("PATCH", `/api/users/${a.id}abc`, { cookie: a.cookie, body: { role: "warehouse" } });
    expect(res.status).toBe(400);
    expect((await rowOf(a.id)).role).toBe("admin");
  });

  it("refuse l'accès à un non-admin (403) avant toute garde", async () => {
    const other = await createTestUser({ role: "warehouse" });
    ids.userIds.push(other.id);
    const login = await call("POST", "/api/auth/login", { body: { username: other.username, password: TEST_USER_PASSWORD } });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const a = await newAdmin();
    const res = await call("PATCH", `/api/users/${a.id}`, { cookie, body: { role: "warehouse" } });
    expect(res.status).toBe(403);
    expect((await rowOf(a.id)).role).toBe("admin");
  });
});

describe("LAG2 : suppression d'un administrateur", { timeout: 60000 }, () => {
  for (const path of ["/api/users", "/api/admin/users"]) {
    it(`DELETE ${path}/:id : un autre admin actif reste -> suppression acceptée`, async () => {
      const a = await newAdmin();
      const b = await newAdmin();
      const res = await call("DELETE", `${path}/${b.id}`, { cookie: a.cookie });
      expect(res.status).toBe(204);
      expect((await rowOf(b.id)).deletedAt).not.toBeNull();
    });

    it(`DELETE ${path}/:id : l'admin ne se supprime pas lui-même (400)`, async () => {
      const a = await newAdmin();
      const res = await call("DELETE", `${path}/${a.id}`, { cookie: a.cookie });
      expect(res.status).toBe(400);
      expect((await rowOf(a.id)).deletedAt).toBeNull();
    });
  }
});

describe("LAG3 : deux admins se retirent mutuellement en même temps", { timeout: 60000 }, () => {
  // Chaque test ne doit voir que ses deux admins : les admins actifs sont désactivés avant chaque
  // test. Les nôtres le restent (nettoyés ensuite) ; les préexistants de la base de test (compte du
  // seed) sont rétablis en fin de bloc. Les suites de contrat s'enchaînent sous verrou.
  const preexisting = new Set<number>();
  async function isolateAdmins() {
    const active = await listActiveAdminIds();
    for (const id of active) if (!ids.userIds.includes(id)) preexisting.add(id);
    if (active.length > 0) await db.update(users).set({ deletedAt: new Date() }).where(inArray(users.id, active));
  }
  // Restauration en finally. Si le processus meurt en plein bloc, les admins préexistants restent
  // désactivés : la base de test locale se répare par `UPDATE users SET deleted_at = NULL WHERE role = 'admin'`.
  afterAll(async () => {
    try {
      if (lockHolder) await lockHolder.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
    } finally {
      lockHolder?.release(true);
      if (preexisting.size > 0) await db.update(users).set({ deletedAt: null }).where(inArray(users.id, [...preexisting]));
    }
  });

  // Connexion du test qui tient elle-même le verrou de la garde pour forcer l'entrelacement.
  let lockHolder: PoolClient | undefined;
  const LOCK = "SELECT pg_advisory_lock(hashtext('fleetmaster_last_admin'))";
  const UNLOCK = "SELECT pg_advisory_unlock(hashtext('fleetmaster_last_admin'))";
  async function takeLock() {
    lockHolder = await pool.connect();
    await lockHolder.query(LOCK);
  }
  async function dropLock() {
    if (!lockHolder) return;
    await lockHolder.query(UNLOCK);
    lockHolder.release();
    lockHolder = undefined;
  }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function onlyTheseAreActiveAdmins(a: number, b: number) {
    const active = await listActiveAdminIds();
    return active.length === 2 && active.includes(a) && active.includes(b);
  }

  // La requête perdante est refusée soit par la garde (400), soit par l'authentification (401/403)
  // si la première était déjà écrite : dans tous les cas un seul des deux comptes disparaît.
  const REFUSALS = [400, 401, 403];

  it("rôle : une seule rétrogradation passe, l'autre est refusée ; il reste un admin actif", async (ctx) => {
    await isolateAdmins();
    const a = await newAdmin();
    const b = await newAdmin();
    if (!(await onlyTheseAreActiveAdmins(a.id, b.id))) ctx.skip();
    const [r1, r2] = await Promise.all([
      call("PATCH", `/api/users/${b.id}`, { cookie: a.cookie, body: { role: "warehouse" } }),
      call("PATCH", `/api/users/${a.id}`, { cookie: b.cookie, body: { role: "warehouse" } }),
    ]);
    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => REFUSALS.includes(s))).toHaveLength(1);
    expect(await listActiveAdminIds()).toHaveLength(1);
  });

  it("la garde attend le verrou (entrelacement forcé) : rien n'est supprimé tant qu'il est tenu", async (ctx) => {
    await isolateAdmins();
    const a = await newAdmin();
    const b = await newAdmin();
    if (!(await onlyTheseAreActiveAdmins(a.id, b.id))) ctx.skip();
    await takeLock();
    let answered = false;
    const pending = call("DELETE", `/api/users/${b.id}`, { cookie: a.cookie }).then((r) => {
      answered = true;
      return r;
    });
    await sleep(800);
    expect(answered).toBe(false);
    expect((await rowOf(b.id)).deletedAt).toBeNull();
    await dropLock();
    expect((await pending).status).toBe(204);
    expect((await rowOf(b.id)).deletedAt).not.toBeNull();
    expect(await listActiveAdminIds()).toEqual([a.id]);
  });

  it("déconnexion du client pendant l'attente du verrou : connexion et verrou rendus, un admin reste actif", async (ctx) => {
    await isolateAdmins();
    const a = await newAdmin();
    const b = await newAdmin();
    if (!(await onlyTheseAreActiveAdmins(a.id, b.id))) ctx.skip();
    await takeLock();
    const port = Number(new URL(baseUrl).port);
    const req = httpRequest({ host: "127.0.0.1", port, path: `/api/users/${b.id}`, method: "DELETE", headers: { Cookie: a.cookie } });
    req.on("error", () => undefined);
    req.end();
    await sleep(600); // la requête attend le verrou côté serveur
    req.destroy();
    await sleep(300);
    await dropLock();
    // le serveur obtient le verrou, constate la coupure et le rend au plus tard au délai de secours
    const probe = await pool.connect();
    try {
      let free = false;
      for (let i = 0; i < 40 && !free; i++) {
        const { rows } = await probe.query("SELECT pg_try_advisory_lock(hashtext('fleetmaster_last_admin')) AS ok");
        free = rows[0].ok === true;
        if (!free) await sleep(250);
      }
      expect(free).toBe(true);
      await probe.query(UNLOCK);
    } finally {
      probe.release();
    }
    expect((await listActiveAdminIds()).length).toBeGreaterThanOrEqual(1);
  });

  it("le détenteur coupe sa connexion en cours de traitement : il reste un admin actif, le verrou est rendu", async (ctx) => {
    await isolateAdmins();
    const a = await newAdmin();
    const b = await newAdmin();
    if (!(await onlyTheseAreActiveAdmins(a.id, b.id))) ctx.skip();
    const port = Number(new URL(baseUrl).port);
    // A envoie sa suppression de B puis ferme aussitôt la socket, sans lire la réponse.
    const aborted = new Promise<void>((resolve) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: `/api/users/${b.id}`, method: "DELETE", headers: { Cookie: a.cookie } });
      req.on("error", () => resolve());
      req.on("close", () => resolve());
      req.end();
      setTimeout(() => req.destroy(), 5);
    });
    const [, rb] = await Promise.all([aborted, call("DELETE", `/api/users/${a.id}`, { cookie: b.cookie })]);
    expect([204, 400, 401, 403]).toContain(rb.status);
    // la garde reste cohérente et le verrou est rendu : une nouvelle requête aboutit sans attendre le filet de 30 s (libération à res.end)
    expect((await listActiveAdminIds()).length).toBeGreaterThanOrEqual(1);
    // une opération qui prend le verrou aboutit (au plus après le délai de secours, si finish n'est pas venu)
    const probe = await newAdmin();
    const victim = await newAdmin();
    const res = await call("PATCH", `/api/users/${victim.id}`, { cookie: probe.cookie, body: { role: "warehouse" } });
    expect(res.status).toBe(200);
  });

  for (const path of ["/api/users", "/api/admin/users"]) {
    it(`suppression ${path} : une seule passe (204), l'autre est refusée ; il reste un admin actif`, async (ctx) => {
      await isolateAdmins();
      const a = await newAdmin();
      const b = await newAdmin();
      if (!(await onlyTheseAreActiveAdmins(a.id, b.id))) ctx.skip();
      const [r1, r2] = await Promise.all([
        call("DELETE", `${path}/${b.id}`, { cookie: a.cookie }),
        call("DELETE", `${path}/${a.id}`, { cookie: b.cookie }),
      ]);
      const statuses = [r1.status, r2.status];
      expect(statuses.filter((s) => s === 204)).toHaveLength(1);
      expect(statuses.filter((s) => REFUSALS.includes(s))).toHaveLength(1);
      expect(await listActiveAdminIds()).toHaveLength(1);
    });
  }
});
