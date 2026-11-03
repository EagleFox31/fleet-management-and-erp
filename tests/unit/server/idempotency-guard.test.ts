import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { isReplayableStatus } from "../../../server/lib/idempotency-config";
import { hashRequest, type IdempotencyStore, type ReserveOutcome } from "../../../server/lib/idempotency-store";
import { idempotencyGuard } from "../../../server/middleware/idempotency-guard";

/**
 * Niveau A, garde d'idempotence (lot #10b) avec un stockage factice : décisions du garde
 * sans base. Le stockage réel est couvert par tests/integration/idempotency-store.test.ts.
 */

const ROUTES = [{ method: "PUT", pattern: /^\/missions\/\d+\/status$/ }] as const;

function fakeStore(outcome: ReserveOutcome = { kind: "reserved" }) {
  const calls: string[] = [];
  const store: IdempotencyStore = {
    reserve: vi.fn(async () => (calls.push("reserve"), outcome)),
    complete: vi.fn(async (_u, _k, status) => void calls.push(`complete:${status}`)),
    release: vi.fn(async () => void calls.push("release")),
    purgeExpired: vi.fn(async () => 0),
  };
  return { store, calls };
}

function fakeReq(over: Partial<{ method: string; url: string; key: string | undefined; userId: number | undefined; body: unknown }> = {}) {
  // `in` plutôt qu'une valeur par défaut : un `undefined` explicite doit rester absent.
  const { method = "PUT", url = "/api/missions/7/status", body = { status: "in_progress" } } = over;
  const key = "key" in over ? over.key : "k-1";
  const userId = "userId" in over ? over.userId : 3;
  return {
    method,
    originalUrl: url,
    body,
    session: userId === undefined ? {} : { userId },
    requestId: "req-test",
    get: (name: string) => (name.toLowerCase() === "idempotency-key" ? key : undefined),
  } as never;
}

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    sent: unknown[];
    status: (code: number) => typeof res;
    setHeader: (n: string, v: string) => void;
    json: (body: unknown) => typeof res;
  };
  res.statusCode = 200;
  res.headers = {};
  res.sent = [];
  res.status = (code) => ((res.statusCode = code), res);
  res.setHeader = (n, v) => void (res.headers[n] = v);
  res.json = (body) => (res.sent.push(body), res);
  return res;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  process.env.FEATURE_FLAGS = "offline-writes=on";
});
afterEach(() => {
  delete process.env.FEATURE_FLAGS;
});

describe("garde d'idempotence : conditions d'entrée", () => {
  it.each([
    ["drapeau coupé", { flags: "technician-offline=on" }],
    ["route non listée", { url: "/api/vehicles/7/maintenance-position" }],
    ["sans en-tête", { key: undefined }],
    ["sans session", { userId: undefined }],
  ])("%s : la requête passe sans toucher au stockage", async (_label, over) => {
    if ("flags" in over) process.env.FEATURE_FLAGS = over.flags;
    const { store } = fakeStore();
    const next = vi.fn();
    await idempotencyGuard(ROUTES, store)(fakeReq(over as never), fakeRes() as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it("clé invalide : 400", async () => {
    const next = vi.fn();
    await idempotencyGuard(ROUTES, fakeStore().store)(fakeReq({ key: "a b" }), fakeRes() as never, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect((next.mock.calls[0][0] as AppError).status).toBe(400);
  });

  it("chemin normalisé (casse, encodage) avant comparaison et empreinte", async () => {
    const { store } = fakeStore();
    await idempotencyGuard(ROUTES, store)(fakeReq({ url: "/api/Missions/%37/STATUS/" }), fakeRes() as never, vi.fn());
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: 3, key: "k-1", method: "PUT", path: "/missions/7/status" }));
  });
});

describe("garde d'idempotence : décisions", () => {
  it("rejeu : réponse enregistrée, en-tête Idempotent-Replayed, route non exécutée", async () => {
    const { store } = fakeStore({ kind: "replay", status: 200, body: { id: 7, status: "in_progress" } });
    const res = fakeRes();
    const next = vi.fn();
    await idempotencyGuard(ROUTES, store)(fakeReq(), res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.sent).toEqual([{ id: 7, status: "in_progress" }]);
    expect(res.headers["Idempotent-Replayed"]).toBe("true");
  });

  it.each([
    ["in_progress", 409],
    ["mismatch", 422],
  ] as const)("%s : %i", async (kind, status) => {
    const next = vi.fn();
    await idempotencyGuard(ROUTES, fakeStore({ kind }).store)(fakeReq(), fakeRes() as never, next);
    expect((next.mock.calls[0][0] as AppError).status).toBe(status);
  });

  it("stockage indisponible : 503, la route ne s'exécute pas", async () => {
    const { store } = fakeStore();
    store.reserve = vi.fn(async () => {
      throw new Error("db down");
    });
    const next = vi.fn();
    await idempotencyGuard(ROUTES, store)(fakeReq(), fakeRes() as never, next);
    expect((next.mock.calls[0][0] as AppError).status).toBe(503);
  });

  it("réservée puis 200 : réponse enregistrée avant l'envoi", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    const next = vi.fn();
    await idempotencyGuard(ROUTES, store)(fakeReq(), res as never, next);
    expect(next).toHaveBeenCalledWith();
    res.status(200).json({ ok: true });
    expect(res.sent).toEqual([]);
    await flush();
    expect(calls).toEqual(["reserve", "complete:200"]);
    expect(res.sent).toEqual([{ ok: true }]);
  });

  it.each([500, 401, 403, 429])("réservée puis %i : clé libérée", async (status) => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await idempotencyGuard(ROUTES, store)(fakeReq(), res as never, vi.fn());
    res.status(status).json({ message: "x" });
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
    expect(res.sent).toHaveLength(1);
  });

  it("connexion fermée sans réponse JSON : clé libérée une seule fois", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await idempotencyGuard(ROUTES, store)(fakeReq(), res as never, vi.fn());
    res.emit("close");
    res.emit("close");
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
  });

  it("enregistrement en échec : clé libérée, la réponse part quand même", async () => {
    const { store, calls } = fakeStore();
    store.complete = vi.fn(async () => {
      throw new Error("write failed");
    });
    const res = fakeRes();
    await idempotencyGuard(ROUTES, store)(fakeReq(), res as never, vi.fn());
    res.status(200).json({ ok: true });
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
    expect(res.sent).toEqual([{ ok: true }]);
  });
});

describe("empreinte et statuts rejouables", () => {
  it("empreinte indépendante de l'ordre des clés, sensible au contenu", () => {
    expect(hashRequest("PUT", "/missions/7/status", { a: 1, b: { c: 2, d: 3 } })).toBe(
      hashRequest("put", "/missions/7/status", { b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(hashRequest("PUT", "/missions/7/status", { a: 1 })).not.toBe(hashRequest("PUT", "/missions/7/status", { a: 2 }));
    expect(hashRequest("PUT", "/missions/7/status", { a: 1 })).not.toBe(hashRequest("PUT", "/missions/8/status", { a: 1 }));
  });

  it("2xx et 4xx métier rejoués ; 5xx et refus de session ou de débit libérés", () => {
    for (const s of [200, 201, 400, 404, 409, 422]) expect(isReplayableStatus(s), String(s)).toBe(true);
    for (const s of [401, 403, 408, 429, 500, 503]) expect(isReplayableStatus(s), String(s)).toBe(false);
  });
});
