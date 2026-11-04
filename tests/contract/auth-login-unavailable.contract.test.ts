import { createServer, type Server } from "http";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import session from "express-session";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";
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

async function login(password: unknown, as: string = username) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: as, password }),
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

/**
 * Coupure de la base sur la lecture de la ligne complète d'un compte (`db.select().from(users)`,
 * celle de `storage.getUserByUsername`), les autres requêtes passent. La panne est simulée sous
 * storage, pas sur storage : un mock qui rejette à la place de `getUserByUsername` passait même
 * quand la vraie méthode avalait l'erreur et renvoyait `undefined` (garantie fictive, #260).
 */
function failUserRowLookup(error: Error): void {
  const realSelect = db.select.bind(db) as (...args: unknown[]) => { from: (table: unknown) => unknown };
  vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
    const query = realSelect(...args);
    if (args.length > 0) return query;
    const realFrom = query.from.bind(query);
    query.from = (table: unknown) => (table === users ? { where: () => Promise.reject(error) } : realFrom(table));
    return query;
  }) as unknown as typeof db.select);
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
  // Clé stockée : empreinte du nom (M3).
  await db.delete(loginAttemptsByUsername).where(eq(loginAttemptsByUsername.usernameNormalized, storedLockoutKey(username)));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("POST /api/auth/login, base indisponible", { timeout: 60000 }, () => {
  it("répond 503 au contrat d'erreur, sans parler d'identifiants ni compter d'échec", async () => {
    const before = await failedCount();
    failUserRowLookup(new Error("Connection terminated unexpectedly"));

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

  it("session.regenerate en échec : 503, et l'échec n'est pas compté", async () => {
    const before = await failedCount();
    vi.spyOn(session.Session.prototype, "regenerate").mockImplementationOnce(function (this: unknown, callback) {
      callback(new Error("session store down"));
      return this as session.Session;
    });

    const res = await login(TEST_USER_PASSWORD);

    expect(apiErrorProblems(res.status, res.text, 503, "INTERNAL", res.requestId)).toEqual([]);
    expect(res.text).not.toContain("session store down");
    expect(await settledFailedCount()).toBe(before);
  });
});

/**
 * Oracle d'énumération (#256, audit de sécurité) : avec un `password` non chaîne, bcrypt.compare levait,
 * et seulement pour un compte existant et actif. Le compte existant répondait 503, l'inconnu 401.
 * Le corps est désormais validé avant la recherche du compte : même 400 dans les deux cas.
 */
describe("POST /api/auth/login, corps mal typé", { timeout: 60000 }, () => {
  for (const [label, password] of [
    ["nombre", 1],
    ["objet", {}],
  ] as const) {
    it(`password ${label} : 400 identique pour un compte existant et un nom inconnu`, async () => {
      const lookup = vi.spyOn(storage, "getUserByUsername");
      const known = await login(password);
      const unknown = await login(password, `inconnu-${Date.now().toString(36)}`);

      expect(known.status).toBe(400);
      expect(unknown.status).toBe(known.status);
      expect(JSON.parse(unknown.text).message).toBe(JSON.parse(known.text).message);
      expect(lookup, "aucune recherche de compte avant validation").not.toHaveBeenCalled();
    });
  }
});

/**
 * Oracle de temps (#260) : un nom inconnu répondait sans calcul bcrypt, donc plus vite qu'un compte
 * existant. Le handler compare désormais à un hash factice : exactement une comparaison bcrypt
 * dans les deux cas, même réponse.
 */
describe("POST /api/auth/login, même travail pour un nom inconnu", { timeout: 60000 }, () => {
  it("une seule comparaison bcrypt pour un compte existant comme pour un nom inconnu", async () => {
    const compare = vi.spyOn(bcrypt, "compare");

    const known = await login("mauvais-mot-de-passe");
    const knownCalls = compare.mock.calls.length;
    compare.mockClear();
    const unknown = await login("mauvais-mot-de-passe", `inconnu-${Date.now().toString(36)}`);

    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(JSON.parse(unknown.text).message).toBe(JSON.parse(known.text).message);
    expect(knownCalls, "compte existant").toBe(1);
    expect(compare.mock.calls.length, "nom inconnu").toBe(1);
  });

  it("compte au hash SHA-256 hérité : une seule comparaison bcrypt, contre un hash de 60 caractères", async () => {
    const legacyPassword = "ancien-mot-de-passe";
    const legacy = await createTestUser({ role: "technician" });
    ids.userIds.push(legacy.id);
    await db
      .update(users)
      .set({ password: crypto.createHash("sha256").update(legacyPassword).digest("hex") })
      .where(eq(users.id, legacy.id));
    const compare = vi.spyOn(bcrypt, "compare");

    const wrong = await login("mauvais-mot-de-passe", legacy.username);
    expect(wrong.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(String(compare.mock.calls[0][1]), "jamais contre le hash SHA-256").toHaveLength(60);

    compare.mockClear();
    const right = await login(legacyPassword, legacy.username);
    expect(right.status, "le mot de passe hérité reste accepté").toBe(200);
    expect(compare).toHaveBeenCalledTimes(1);
    await db.delete(loginAttemptsByUsername).where(eq(loginAttemptsByUsername.usernameNormalized, storedLockoutKey(legacy.username)));
  });

  it("la recherche du compte en panne n'est jamais lue comme un nom inconnu", async () => {
    failUserRowLookup(new Error("Connection terminated unexpectedly"));
    await expect(storage.getUserByUsername(username)).rejects.toThrow("Connection terminated");
  });
});
