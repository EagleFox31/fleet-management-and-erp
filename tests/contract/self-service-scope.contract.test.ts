import { createServer, type Server } from "http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { loginAttemptsByUsername, userOnboarding } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * R1 : routes d'écriture libre-service (tests/unit/server/support/write-routes-self-service.ts).
 * Sans garde de rôle, ouvertes à tout compte connecté, client compris : la preuve qu'elles
 * n'agissent que sur le compte de session est ici. Un compte A (client) agit, en glissant
 * l'identifiant d'un compte B dans le corps ; B ne doit rien voir changer.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const accounts: Record<"a" | "b", { id: number; username: string; cookie: string }> = {} as never;

async function call(method: string, path: string, options: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function login(username: string, password: string) {
  return call("POST", "/api/auth/login", { body: { username, password } });
}

async function onboardingOf(userId: number) {
  const [row] = await db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId));
  return row;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const [label, role] of [["a", "client"], ["b", "technician"]] as const) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await login(user.username, TEST_USER_PASSWORD);
    expect(res.status).toBe(200);
    accounts[label] = { id: user.id, username: user.username, cookie: res.cookie! };
  }
}, 180000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const userIds = [accounts.a?.id, accounts.b?.id].filter((x): x is number => typeof x === "number");
  if (userIds.length) await db.delete(userOnboarding).where(inArray(userOnboarding.userId, userIds));
  for (const { username } of Object.values(accounts)) {
    await db.delete(loginAttemptsByUsername).where(like(loginAttemptsByUsername.usernameNormalized, `%${username.trim().toLowerCase()}`));
  }
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("R1 : routes libre-service, compte de session seulement", { timeout: 120000 }, () => {
  it("sans session : 401 sur chaque route", async () => {
    for (const [method, path] of [
      ["POST", "/api/users/change-password"],
      ["PATCH", "/api/onboarding/step"],
      ["PATCH", "/api/onboarding/complete"],
      ["PATCH", "/api/onboarding/mascot"],
    ]) {
      expect((await call(method, path, { body: {} })).status, `${method} ${path}`).toBe(401);
    }
  });

  it("accueil : A (client) avance, termine et masque la mascotte ; autre compte (B) : sa ligne ne bouge pas", async () => {
    // GET /status crée la ligne de chacun.
    for (const who of ["a", "b"] as const) {
      expect((await call("GET", "/api/onboarding/status", { cookie: accounts[who].cookie })).status).toBe(200);
    }
    const before = await onboardingOf(accounts.b.id);
    const foreign = { userId: accounts.b.id };

    const step = await call("PATCH", "/api/onboarding/step", {
      cookie: accounts.a.cookie,
      body: { currentStep: 4, stepsCompleted: ["vehicles"], ...foreign },
    });
    expect(step.status).toBe(200);
    expect(step.body.userId).toBe(accounts.a.id);
    expect((await call("PATCH", "/api/onboarding/complete", { cookie: accounts.a.cookie, body: foreign })).status).toBe(200);
    expect((await call("PATCH", "/api/onboarding/mascot", { cookie: accounts.a.cookie, body: { mascotHidden: true, ...foreign } })).status).toBe(200);

    const a = await onboardingOf(accounts.a.id);
    expect(a).toMatchObject({ currentStep: 4, onboardingCompleted: true, mascotHidden: true });
    const b = await onboardingOf(accounts.b.id);
    expect(b, "la ligne de B est inchangée").toEqual(before);
  });

  it("mot de passe : A change le sien ; autre compte (B) : son userId dans le corps est ignoré, B se connecte comme avant", async () => {
    const newPassword = `nouveau-${Date.now().toString(36)}`;
    const res = await call("POST", "/api/users/change-password", {
      cookie: accounts.a.cookie,
      body: { currentPassword: TEST_USER_PASSWORD, newPassword, userId: accounts.b.id },
    });
    expect(res.status).toBe(200);

    expect((await login(accounts.b.username, TEST_USER_PASSWORD)).status, "B garde son mot de passe").toBe(200);
    expect((await login(accounts.a.username, newPassword)).status, "A a changé le sien").toBe(200);
    expect((await login(accounts.a.username, TEST_USER_PASSWORD)).status, "l'ancien mot de passe de A ne vaut plus").toBe(401);
  });

  it("mot de passe : enregistrement non fait, 503 et pas « modifié »", async () => {
    // updateUser avale l'erreur de base et renvoie undefined : c'est ce que le spy reproduit.
    vi.spyOn(storage, "updateUser").mockResolvedValueOnce(undefined);
    const res = await call("POST", "/api/users/change-password", {
      cookie: accounts.b.cookie,
      body: { currentPassword: TEST_USER_PASSWORD, newPassword: "jamais-enregistre" },
    });
    expect(res.status).toBe(503);
    expect(res.body.message).not.toMatch(/succès/i);
    expect((await login(accounts.b.username, TEST_USER_PASSWORD)).status, "l'ancien mot de passe reste valable").toBe(200);
  });
});
