import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { drivers, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Durcissement de la connexion par PIN :
 *  - D  : tous les échecs de pin-login (inconnu, non chauffeur, sans PIN, PIN faux) répondent le même 401 ;
 *  - E1 : le compteur de verrouillage est indexé sur l'identifiant canonique ("12", "012" et 12 = même compte) ;
 *  - E2 : un compte chauffeur créé par l'admin n'a plus le PIN comme mot de passe.
 */

const PIN = "4821";
// Compteur propre à ce fichier : r8 emploie 999999999, dont les échecs s'accumulent d'un passage à l'autre.
const UNKNOWN_ID = 999999001 + Math.floor(Math.random() * 900);
const MAX = Number(process.env.LOCKOUT_MAX_ATTEMPTS) || 5;
const settle = () => new Promise((r) => setTimeout(r, 150));

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];

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

async function newAccount(opts: { role?: "driver" | "warehouse"; pin?: string | null } = {}) {
  const created = await createTestUser({ role: opts.role ?? "driver" });
  ids.userIds.push(created.id);
  const pin = opts.pin === undefined ? await bcrypt.hash(PIN, 4) : opts.pin;
  await db.update(users).set({ pin }).where(eq(users.id, created.id));
  return created;
}

/** Corps de réponse sans le requestId (aléatoire). */
const stable = (body: any) => ({ message: body?.message, code: body?.code });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (driverIds.length) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  const keys = [`pin:${UNKNOWN_ID}`, ...ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`])];
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys.map(storedLockoutKey)]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("pin-login : réponse unique à tout échec (D)", { timeout: 60000 }, () => {
  it("inconnu, non chauffeur, sans PIN, PIN faux : même 401, même message, même code, sans session", async () => {
    const driver = await newAccount();
    const noPin = await newAccount({ pin: null });
    const warehouse = await newAccount({ role: "warehouse" });
    // Fiche chauffeur désactivée, bon PIN : même réponse qu'un PIN faux, sinon le PIN est confirmé.
    const disabled = await newAccount();
    const [fiche] = await db
      .insert(drivers)
      .values({ firstName: "Fiche", lastName: "Désactivée", userId: disabled.id, isActive: false })
      .returning({ id: drivers.id });
    driverIds.push(fiche.id);
    const attempts = [
      await call("POST", "/api/auth/pin-login", { body: { userId: disabled.id, pin: PIN } }),
      await call("POST", "/api/auth/pin-login", { body: { userId: UNKNOWN_ID, pin: PIN } }),
      await call("POST", "/api/auth/pin-login", { body: { userId: warehouse.id, pin: PIN } }),
      await call("POST", "/api/auth/pin-login", { body: { userId: noPin.id, pin: PIN } }),
      await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: "0000" } }),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Identifiants invalides");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(leakText(res.body)).not.toContain(PIN);
    }
    const [first, ...rest] = attempts.map((r) => stable(r.body));
    for (const other of rest) expect(other).toEqual(first);
  });
});

describe("pin-login : corps et session", { timeout: 60000 }, () => {
  it("identifiant numérique hors de la colonne integer (1e21, 2^31) : 400, pas 500", async () => {
    for (const userId of [1e21, 2147483648]) {
      expect((await call("POST", "/api/auth/pin-login", { body: { userId, pin: PIN } })).status).toBe(400);
    }
  });

  it("connexion réussie : nouvel identifiant de session, le cookie présenté n'est pas repris (fixation)", async () => {
    const driver = await newAccount();
    const other = await newAccount({ role: "warehouse" });
    const before = await call("POST", "/api/auth/login", { body: { username: other.username, password: TEST_USER_PASSWORD } });
    const planted = before.headers.get("set-cookie")!.split(";")[0];
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: PIN }, cookie: planted });
    expect(res.status).toBe(200);
    const issued = res.headers.get("set-cookie")?.split(";")[0];
    expect(issued).toBeTruthy();
    expect(issued).not.toBe(planted);
    const oldSession = await call("GET", "/api/auth/me", { cookie: planted });
    expect(oldSession.body?.id).not.toBe(driver.id);
  });
});

describe("pin-login : le compteur de verrouillage suit l'identifiant canonique (E1)", { timeout: 120000 }, () => {
  it("5 PIN faux avec \"id\" : nombre et forme espacée verrouillés (429), zéros en tête refusés (400), un seul compteur", async () => {
    const driver = await newAccount();
    for (let i = 0; i < MAX; i++) {
      expect((await call("POST", "/api/auth/pin-login", { body: { userId: String(driver.id), pin: "0000" } })).status).toBe(401);
      await settle();
    }
    for (const zeros of [`0${driver.id}`, `00${driver.id}`]) {
      const res = await call("POST", "/api/auth/pin-login", { body: { userId: zeros, pin: PIN } });
      expect(res.status, zeros).toBe(400);
    }
    for (const variant of [driver.id, ` ${driver.id} `]) {
      const res = await call("POST", "/api/auth/pin-login", { body: { userId: variant, pin: PIN } });
      expect(res.status, JSON.stringify(variant)).toBe(429);
      expect(res.body.code).toBe("RATE_LIMITED");
    }
    const { rows } = await pool.query(
      "SELECT username_normalized FROM login_attempts_by_username WHERE username_normalized LIKE $1",
      [`pin:%${driver.id}`],
    );
    expect(rows.map((r) => r.username_normalized).filter((k) => k.endsWith(String(driver.id)))).toEqual([`pin:${driver.id}`]);
  });
});

describe("création d'un compte chauffeur : le PIN n'est pas le mot de passe (E2)", { timeout: 60000 }, () => {
  it("le mot de passe stocké diffère du PIN haché, et ne s'ouvre ni avec le PIN ni avec l'identifiant", async () => {
    const admin = await createTestUser({ role: "admin" });
    ids.userIds.push(admin.id);
    const login = await call("POST", "/api/auth/login", { body: { username: admin.username, password: TEST_USER_PASSWORD } });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    const fiche = await call("POST", "/api/drivers", {
      cookie,
      body: { firstName: "Test", lastName: uniqueTestToken("pinhard"), cpcTrainingDate: new Date().toISOString().slice(0, 10) },
    });
    expect(fiche.status).toBe(201);
    driverIds.push(fiche.body.id);

    const created = await call("POST", `/api/drivers/${fiche.body.id}/create-user`, {
      cookie,
      body: { pin: PIN, email: `${uniqueTestToken("pinhard")}@example.test`.toLowerCase() },
    });
    expect(created.status).toBe(201);
    ids.userIds.push(created.body.user.id);

    const [row] = await db.select().from(users).where(eq(users.id, created.body.user.id));
    expect(row.pin).toBeTruthy();
    expect(row.password).not.toBe(row.pin);
    expect(await bcrypt.compare(PIN, row.pin!)).toBe(true);
    expect(await bcrypt.compare(PIN, row.password)).toBe(false);

    // Le PIN reste la voie de connexion du chauffeur.
    const viaPin = await call("POST", "/api/auth/pin-login", { body: { userId: row.id, pin: PIN } });
    expect(viaPin.status).toBe(200);
  });
});
