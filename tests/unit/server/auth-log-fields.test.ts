import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Garde-fou d'exécution : ce que le middleware d'authentification écrit réellement dans les journaux.
 * Un scan du source ne voit pas `{ req }`, `{ user }` ou `req.originalUrl` ; ici on exécute les gardes
 * sur une requête piégée (cookie, Authorization, jeton en query, mot de passe en corps) et on lit les
 * lignes pino produites, avec les vraies options du projet (`loggerOptions`) au niveau debug.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("../../../server/lib/logger", async () => {
  const pino = (await import("pino")).default;
  const actual = await vi.importActual<typeof import("../../../server/lib/logger")>("../../../server/lib/logger");
  const logger = pino({ ...actual.loggerOptions, level: "debug" }, { write: (line: string) => void captured.lines.push(line) });
  return { ...actual, logger, moduleLogger: (module: string) => logger.child({ module }) };
});

const findActiveSessionUser = vi.hoisted(() => vi.fn());
vi.mock("../../../server/services/session-user", () => ({ findActiveSessionUser }));

import { authenticate, authorize } from "../../../server/middleware/auth";

const COOKIE = "connect.sid=s%3ACOOKIE-VALUE-7f3a";
const BEARER = "Bearer BEARER-SECRET-91bc";
const QUERY_TOKEN = "QUERYTOKEN-55de";
const PASSWORD = "PASSWORD-VALUE-c0ffee";
const SESSION_ID = "SESSION-ID-2a9d";
const EMAIL = "someone-private@example.test";
const SENSITIVE = [COOKIE.split("=")[1], "BEARER-SECRET-91bc", QUERY_TOKEN, PASSWORD, SESSION_ID, EMAIL];

/** Clés autorisées sur une ligne : bases pino + champs documentés dans la PR. */
const ALLOWED_KEYS = new Set([
  "level", "time", "service", "module", "msg",
  "requestId", "method", "path", "hasSession", "userId", "role", "rawRole", "allowedRoles",
]);

function trappedRequest(withSession = true) {
  return {
    requestId: "req-test-1",
    method: "POST",
    path: "/api/parts",
    originalUrl: `/api/parts?token=${QUERY_TOKEN}`,
    url: `/api/parts?token=${QUERY_TOKEN}`,
    query: { token: QUERY_TOKEN },
    headers: { cookie: COOKIE, authorization: BEARER },
    body: { password: PASSWORD, email: EMAIL },
    sessionID: SESSION_ID,
    session: withSession ? { id: SESSION_ID, userId: 42, cookie: { originalMaxAge: 1 } } : undefined,
  } as any;
}

function fakeRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

function parsedLines(): Record<string, unknown>[] {
  return captured.lines.map((l) => JSON.parse(l));
}

function expectOnlyAllowed() {
  const lines = parsedLines();
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const extra = Object.keys(line).filter((k) => !ALLOWED_KEYS.has(k));
    expect(extra, `clés non autorisées dans ${JSON.stringify(line)}`).toEqual([]);
  }
  const serialized = captured.lines.join("\n");
  for (const secret of SENSITIVE) {
    expect(serialized, `valeur sensible journalisée : ${secret}`).not.toContain(secret);
  }
}

describe("middleware d'authentification : champs réellement journalisés", () => {
  beforeEach(() => {
    captured.lines.length = 0;
    findActiveSessionUser.mockReset();
    delete process.env.AUTH_DEBUG;
  });

  it("authenticate : accès autorisé", async () => {
    findActiveSessionUser.mockResolvedValue({ id: 42, role: "admin", username: "u" });
    const next = vi.fn();
    await authenticate(trappedRequest(), fakeRes(), next);
    expect(next).toHaveBeenCalled();
    expectOnlyAllowed();
  });

  it("authenticate : non authentifié", async () => {
    const res = fakeRes();
    await authenticate(trappedRequest(false), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expectOnlyAllowed();
  });

  it("authenticate : compte supprimé ou inconnu", async () => {
    findActiveSessionUser.mockResolvedValue(undefined);
    const res = fakeRes();
    await authenticate(trappedRequest(), res, vi.fn());
    expect(res.statusCode).toBe(401);
    expectOnlyAllowed();
  });

  it("authorize : accès autorisé, rôle brut et normalisé journalisés", async () => {
    findActiveSessionUser.mockResolvedValue({ id: 42, role: "Magasinier", username: "u" });
    const next = vi.fn();
    await authorize(["warehouse"])(trappedRequest(), fakeRes(), next);
    expect(next).toHaveBeenCalled();
    expectOnlyAllowed();
    const last = parsedLines().at(-1)!;
    expect(last).toMatchObject({ role: "warehouse", rawRole: "Magasinier", allowedRoles: ["warehouse"] });
  });

  it("authorize : refus 403 d'un rôle inconnu, rôle brut conservé pour le diagnostic", async () => {
    findActiveSessionUser.mockResolvedValue({ id: 42, role: "gestionaire_atelier", username: "u" });
    const res = fakeRes();
    await authorize(["admin"])(trappedRequest(), res, vi.fn());
    expect(res.statusCode).toBe(403);
    expectOnlyAllowed();
    const refusal = parsedLines().find((l) => String(l.msg).includes("rôle non autorisé"))!;
    expect(refusal).toMatchObject({ level: 30, role: "user", rawRole: "gestionaire_atelier" });
  });
});
