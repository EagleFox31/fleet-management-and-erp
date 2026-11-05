import { createServer, type Server } from "http";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { LAST_ADMIN_MESSAGE } from "../../server/lib/last-admin-rule";
import { listActiveAdminIds } from "../../server/lib/last-admin";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Refus du trigger « au moins un administrateur actif » sur les quatre routes d'écriture : réponse 400
 * lisible (même message que la garde applicative), jamais 404 ni 500. Une requête isolée ne peut pas viser
 * le dernier admin (l'appelant en est un) : le test reproduit la course où la garde a laissé passer la
 * requête, en retirant l'appelant des admins actifs juste avant l'écriture, depuis la lecture ou l'écriture
 * de la cible dans le stockage.
 */
const race = vi.hoisted(() => ({ before: undefined as undefined | (() => Promise<void>), targetId: 0 }));
vi.mock("../../server/storage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../server/storage")>();
  const wrap = <K extends "getUser" | "deleteUser">(name: K) => {
    const original = (mod.storage as any)[name].bind(mod.storage);
    (mod.storage as any)[name] = async (id: number, ...rest: unknown[]) => {
      if (id === race.targetId && race.before) {
        const run = race.before;
        race.before = undefined;
        await run();
      }
      return original(id, ...rest);
    };
  };
  wrap("getUser");
  wrap("deleteUser");
  return mod;
});

const triggerPresent =
  (await db.execute(sql`SELECT 1 AS present FROM pg_trigger WHERE tgname = 'trg_users_keep_active_admin' AND NOT tgisinternal`)).rows.length > 0;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const preexisting = new Set<number>();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function newAdmin() {
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await call("POST", "/api/auth/login", { body: { username: admin.username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return { id: admin.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

/** État de départ hors trigger : `SET LOCAL` ne dure que le temps de la transaction. */
async function setDeletedAt(userIds: number[], deletedAt: Date | null) {
  if (userIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.update(users).set({ deletedAt }).where(inArray(users.id, userIds));
  });
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60000);

afterAll(async () => {
  race.before = undefined;
  try {
    await setDeletedAt([...preexisting], null);
    await cleanupCreated(ids);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

const ROUTES: Array<{ name: string; run: (cookie: string, targetId: number) => ReturnType<typeof call> }> = [
  { name: "PATCH /api/users/:id (rôle)", run: (cookie, id) => call("PATCH", `/api/users/${id}`, { cookie, body: { role: "warehouse" } }) },
  { name: "DELETE /api/users/:id", run: (cookie, id) => call("DELETE", `/api/users/${id}`, { cookie }) },
  { name: "DELETE /api/admin/users/:id", run: (cookie, id) => call("DELETE", `/api/admin/users/${id}`, { cookie }) },
  { name: "PATCH /api/admin/users/:id/toggle (désactivation)", run: (cookie, id) => call("PATCH", `/api/admin/users/${id}/toggle`, { cookie, body: { isActive: false } }) },
];

describe.skipIf(!triggerPresent)("refus du trigger traduit en 400 lisible (ignoré si le trigger de base est absent)", { timeout: 60000 }, () => {
  for (const route of ROUTES) {
    it(`${route.name} : 400 avec le message de la garde, le dernier admin reste actif`, async (ctx) => {
      // Tous les admins actifs (ceux d'un cas précédent compris) sortent avant que les deux comptes du cas soient créés.
      const active = await listActiveAdminIds();
      for (const id of active) if (!ids.userIds.includes(id)) preexisting.add(id);
      await setDeletedAt(active, new Date());
      const caller = await newAdmin();
      const target = await newAdmin();
      const others = (await listActiveAdminIds()).filter((id) => id !== caller.id && id !== target.id);
      if (others.length > 0) ctx.skip();
      // Entre le contrôle et l'écriture, l'appelant n'est plus admin actif : la cible devient le dernier.
      race.targetId = target.id;
      race.before = () => setDeletedAt([caller.id], new Date());
      const res = await route.run(caller.cookie, target.id);
      race.before = undefined;
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.message).toBe(LAST_ADMIN_MESSAGE);
      expect(res.body.requestId).toBeTruthy();
      const [row] = await db.select({ role: users.role, deletedAt: users.deletedAt }).from(users).where(eq(users.id, target.id));
      expect(row.role).toBe("admin");
      expect(row.deletedAt).toBeNull();
    });
  }
});
