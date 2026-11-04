import { createServer, type Server } from "http";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { loginAttemptsByUsername, users } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Niveau C, #254 : une panne pendant la connexion est une 5xx, jamais un 401.
 *
 * Avant le correctif, le `catch` du handler de `POST /api/auth/login` répondait 401. L'écran
 * affichait « vérifiez vos identifiants », et le garde de verrouillage (`loginLockoutGuard`,
 * qui compte chaque 401) enregistrait un échec : une panne de base pouvait verrouiller un
 * compte dont le mot de passe était juste.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
let username = "";
let userId = 0;

async function login(password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, text: await res.text(), requestId: res.headers.get("x-request-id") };
}

/** Miroir du compteur du garde sur le compte (`users.failed_login_count`). */
async function failedCount(): Promise<number> {
  const [row] = await db.select({ count: users.failedLoginCount }).from(users).where(eq(users.id, userId));
  return row?.count ?? 0;
}

/** Le garde écrit son compteur sur `finish`, sans être attendu : on lui laisse le temps d'écrire. */
async function settledFailedCount(): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return failedCount();
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const user = await createTestUser({ role: "technician" });
  ids.userIds.push(user.id);
  username = user.username;
  userId = user.id;
}, 180000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Clé du garde : préfixe (`pwd:`) puis nom normalisé.
  await db.delete(loginAttemptsByUsername).where(like(loginAttemptsByUsername.usernameNormalized, `%${username.trim().toLowerCase()}`));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/auth/login, base indisponible", { timeout: 60000 }, () => {
  it("répond 503 au contrat d'erreur, sans parler d'identifiants ni compter d'échec", async () => {
    const before = await failedCount();
    vi.spyOn(storage, "getUserByUsername").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

    const res = await login(TEST_USER_PASSWORD);

    expect(apiErrorProblems(res.status, res.text, 503, "INTERNAL", res.requestId)).toEqual([]);
    expect(res.text).not.toMatch(/identifiants/i);
    expect(res.text).not.toContain("Connection terminated");
    expect(await settledFailedCount(), "une panne n'est pas un échec de connexion").toBe(before);
  });

  it("la connexion réussit dès que la base répond de nouveau", async () => {
    const res = await login(TEST_USER_PASSWORD);
    expect(res.status).toBe(200);
  });

  it("un mauvais mot de passe reste un 401 compté par le garde", async () => {
    const before = await failedCount();
    const res = await login("mauvais-mot-de-passe");
    expect(res.status).toBe(401);
    expect(await settledFailedCount()).toBe(before + 1);
  });
});
