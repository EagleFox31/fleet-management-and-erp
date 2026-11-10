import { EventEmitter } from "events";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { IDEMPOTENCY_ROUTES, isPreWriteRefusal, isReplayableStatus } from "../../../server/lib/idempotency-config";
import { FEATURE_FLAGS } from "../../../shared/feature-flags";
import { hashRequest, type IdempotencyStore, type ReserveOutcome } from "../../../server/lib/idempotency-store";
import { findIdempotentRoute, idempotencyGuard } from "../../../server/middleware/idempotency-guard";
import { BACKSLASH, sendRaw } from "../../support/raw-request";

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
  // Comme sous `app.use("/api", apiRouter)` : la garde lit `baseUrl + path` (chemin du routeur).
  const pathname = url.split(/[?#]/)[0];
  const mounted = /^\/api(?=\/|$)/i.exec(pathname);
  return {
    method,
    originalUrl: url,
    baseUrl: mounted ? mounted[0] : "",
    path: mounted ? pathname.slice(mounted[0].length) || "/" : pathname,
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

/** Compte de session factice : présent par défaut, `undefined` = compte supprimé. */
const guard = (store: IdempotencyStore, findUser: (id: number) => Promise<unknown> = async (id) => ({ id })) =>
  idempotencyGuard(ROUTES, store, findUser);

/** Stockage en mémoire : réserver, enregistrer et rejouer réellement (une seule clé suffit ici). */
function memoryStore() {
  const calls: string[] = [];
  let saved: { status: number; body: unknown } | "pending" | undefined;
  const store: IdempotencyStore = {
    reserve: vi.fn(async () => {
      calls.push("reserve");
      if (saved === undefined) return (saved = "pending"), { kind: "reserved" } as const;
      if (saved === "pending") return { kind: "in_progress" } as const;
      return { kind: "replay", status: saved.status, body: saved.body } as const;
    }),
    complete: vi.fn(async (_u, _k, status, body) => void (calls.push(`complete:${status}`), (saved = { status, body }))),
    release: vi.fn(async () => void (calls.push("release"), (saved = undefined))),
    purgeExpired: vi.fn(async () => 0),
  };
  return { store, calls };
}

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
    await guard(store)(fakeReq(over as never), fakeRes() as never, next);
    expect(next).toHaveBeenCalledWith();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it("clé invalide : 400", async () => {
    const next = vi.fn();
    await guard(fakeStore().store)(fakeReq({ key: "a b" }), fakeRes() as never, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect((next.mock.calls[0][0] as AppError).status).toBe(400);
  });

  it("chemin normalisé (casse, encodage) avant comparaison et empreinte", async () => {
    const { store } = fakeStore();
    await guard(store)(fakeReq({ url: "/api/Missions/%37/STATUS/" }), fakeRes() as never, vi.fn());
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: 3, key: "k-1", method: "PUT", path: "/missions/7/status" }), undefined);
  });
});

describe("garde d'idempotence : décisions", () => {
  it("rejeu : réponse enregistrée, en-tête Idempotent-Replayed, route non exécutée", async () => {
    const { store } = fakeStore({ kind: "replay", status: 200, body: { id: 7, status: "in_progress" } });
    const res = fakeRes();
    const next = vi.fn();
    await guard(store)(fakeReq(), res as never, next);
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
    await guard(fakeStore({ kind }).store)(fakeReq(), fakeRes() as never, next);
    expect((next.mock.calls[0][0] as AppError).status).toBe(status);
  });

  it("409 « en cours » : code IDEMPOTENCY_IN_PROGRESS et message lisible, propre à la route si défini", async () => {
    const next = vi.fn();
    await guard(fakeStore({ kind: "in_progress" }).store)(fakeReq(), fakeRes() as never, next);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.status).toBe(409);
    expect(err.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(err.message).toMatch(/en cours/);

    const custom = idempotencyGuard(
      [{ method: "PUT", pattern: /^\/missions\/\d+\/status$/, inProgressMessage: "Message propre à la route." }],
      fakeStore({ kind: "in_progress" }).store,
      async (id) => ({ id }),
    );
    const next2 = vi.fn();
    await custom(fakeReq(), fakeRes() as never, next2);
    expect((next2.mock.calls[0][0] as AppError).code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect((next2.mock.calls[0][0] as AppError).message).toBe("Message propre à la route.");
  });

  it("la panne du chauffeur est une route rejouable dont la clé n'est ni reprise ni libérée", () => {
    const route = findIdempotentRoute(IDEMPOTENCY_ROUTES, "POST", "/driver/breakdowns");
    expect(route).toBeDefined();
    expect(route?.staleSeconds).toBeNull();
    expect(route?.keepKeyOnUncertainOutcome).toBe(true);
    expect(findIdempotentRoute(IDEMPOTENCY_ROUTES, "GET", "/driver/breakdowns")).toBeUndefined();
    expect(FEATURE_FLAGS["driver-offline"].defaultEnabled).toBe(false);
  });

  it("stockage indisponible : 503, la route ne s'exécute pas", async () => {
    const { store } = fakeStore();
    store.reserve = vi.fn(async () => {
      throw new Error("db down");
    });
    const next = vi.fn();
    await guard(store)(fakeReq(), fakeRes() as never, next);
    expect((next.mock.calls[0][0] as AppError).status).toBe(503);
  });

  it("réservée puis 200 : réponse enregistrée avant l'envoi", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    const next = vi.fn();
    await guard(store)(fakeReq(), res as never, next);
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
    await guard(store)(fakeReq(), res as never, vi.fn());
    res.status(status).json({ message: "x" });
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
    expect(res.sent).toHaveLength(1);
  });

  // B1 (relecture de #131) : libérer sur `close` laissait passer la réponse sans l'enregistrer,
  // et le réessai réexécutait l'écriture.
  it("connexion coupée puis réponse 200 : réponse enregistrée, le réessai rejoue sans réécrire", async () => {
    const { store, calls } = memoryStore();
    const res = fakeRes();
    const run = vi.fn();
    await guard(store)(fakeReq(), res as never, run);
    res.emit("close");
    res.status(200).json({ ok: true });
    await flush();
    expect(calls).toEqual(["reserve", "complete:200"]);

    const retry = fakeRes();
    const runAgain = vi.fn();
    await guard(store)(fakeReq(), retry as never, runAgain);
    expect(runAgain).not.toHaveBeenCalled();
    expect(retry.sent).toEqual([{ ok: true }]);
    expect(retry.headers["Idempotent-Replayed"]).toBe("true");
  });

  it("réponse terminée sans JSON : clé libérée une seule fois", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await guard(store)(fakeReq(), res as never, vi.fn());
    res.emit("finish");
    res.emit("finish");
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
  });

  it("finish après une réponse JSON enregistrée : rien n'est libéré", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await guard(store)(fakeReq(), res as never, vi.fn());
    res.status(201).json({ id: 1 });
    await flush();
    res.emit("finish");
    await flush();
    expect(calls).toEqual(["reserve", "complete:201"]);
  });

  // B3 : un compte supprimé n'a rien à réserver (sa clé étrangère ferait un 503).
  it("compte supprimé : 401, aucune réservation, la route ne s'exécute pas", async () => {
    const { store } = fakeStore();
    const next = vi.fn();
    await guard(store, async () => undefined)(fakeReq(), fakeRes() as never, next);
    expect((next.mock.calls[0][0] as AppError).status).toBe(401);
    expect(store.reserve).not.toHaveBeenCalled();
  });

  // M1 : un envoi en échec après l'enregistrement est journalisé, sans rejet non géré.
  it("envoi de la réponse en échec : erreur journalisée, aucun rejet non géré", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    res.json = () => {
      throw new Error("headers already sent");
    };
    await guard(store)(fakeReq(), res as never, vi.fn());
    res.status(200).json({ ok: true });
    await flush();
    await flush();
    expect(calls).toEqual(["reserve", "complete:200"]);
  });

  it("enregistrement en échec : clé libérée, la réponse part quand même", async () => {
    const { store, calls } = fakeStore();
    store.complete = vi.fn(async () => {
      throw new Error("write failed");
    });
    const res = fakeRes();
    await guard(store)(fakeReq(), res as never, vi.fn());
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

  it("véhicule retiré (code VEHICLE_RETIRED) : refus avant écriture, libéré et jamais rejoué", () => {
    expect(isReplayableStatus(409, { message: "m", code: "VEHICLE_RETIRED" })).toBe(false);
    expect(isPreWriteRefusal(409, { code: "VEHICLE_RETIRED" })).toBe(true);
    // Un 409 de conflit ordinaire reste rejoué, et un code seul ne libère pas un succès.
    expect(isReplayableStatus(409, { message: "m", code: "CONFLICT" })).toBe(true);
    expect(isPreWriteRefusal(200, { code: "VEHICLE_RETIRED" })).toBe(false);
    expect(isPreWriteRefusal(409, null)).toBe(false);
  });
});

/**
 * Options par route : écriture de stock, qui ne se rejoue pas à l'identique.
 * Toute issue incertaine garde la clé ; seul un refus avant écriture la libère.
 */
describe("garde d'idempotence : route qui garde sa clé (stock)", () => {
  const STOCK_ROUTES = [
    {
      method: "POST",
      pattern: /^\/parts\/\d+\/update-stock$/,
      staleSeconds: null,
      keepKeyOnUncertainOutcome: true,
      ignoreFeatureFlag: true,
      inProgressMessage: "Opération en cours ou au résultat incertain : vérifiez le stock avant de réessayer.",
    },
  ] as const;
  const stockReq = (over: Parameters<typeof fakeReq>[0] = {}) =>
    fakeReq({ method: "POST", url: "/api/parts/9/update-stock", body: { adjustment: -2, reason: "TEST" }, ...over });
  const stockGuard = (store: IdempotencyStore) => idempotencyGuard(STOCK_ROUTES, store, async (id) => ({ id }));

  it("drapeau offline-writes coupé : la route reste protégée", async () => {
    delete process.env.FEATURE_FLAGS;
    const { store } = fakeStore();
    await stockGuard(store)(stockReq(), fakeRes() as never, vi.fn());
    expect(store.reserve).toHaveBeenCalled();
  });

  it("réservation sans reprise d'une clé en cours (staleSeconds null)", async () => {
    const { store } = fakeStore();
    await stockGuard(store)(stockReq(), fakeRes() as never, vi.fn());
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ path: "/parts/9/update-stock" }), { staleSeconds: null });
  });

  it("route sans option : réservation au délai par défaut", async () => {
    const { store } = fakeStore();
    await guard(store)(fakeReq(), fakeRes() as never, vi.fn());
    expect(store.reserve).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it.each([500, 503])("%i (commit possible, réponse perdue) : clé conservée", async (status) => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await stockGuard(store)(stockReq(), res as never, vi.fn());
    res.status(status).json({ message: "x" });
    await flush();
    expect(calls).toEqual(["reserve"]);
    expect(res.sent).toHaveLength(1);
  });

  it.each([401, 403, 408, 429])("%i (refus avant écriture) : clé libérée", async (status) => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await stockGuard(store)(stockReq(), res as never, vi.fn());
    res.status(status).json({ message: "x" });
    await flush();
    expect(calls).toEqual(["reserve", "release"]);
  });

  it("réponse terminée sans JSON : clé conservée", async () => {
    const { store, calls } = fakeStore();
    const res = fakeRes();
    await stockGuard(store)(stockReq(), res as never, vi.fn());
    res.emit("finish");
    await flush();
    expect(calls).toEqual(["reserve"]);
  });

  it("ajustement validé puis enregistrement en échec : le réessai ne rejoue pas l'ajustement", async () => {
    const { store, calls } = memoryStore();
    store.complete = vi.fn(async () => {
      calls.push("complete:failed");
      throw new Error("write failed");
    });
    const res = fakeRes();
    const route = vi.fn();
    await stockGuard(store)(stockReq(), res as never, route);
    expect(route).toHaveBeenCalledTimes(1);
    res.status(200).json({ quantity: 8 });
    await flush();
    expect(calls).toEqual(["reserve", "complete:failed"]);
    expect(res.sent).toEqual([{ quantity: 8 }]);

    const retryNext = vi.fn();
    await stockGuard(store)(stockReq(), fakeRes() as never, retryNext);
    expect(retryNext).toHaveBeenCalledTimes(1);
    const err = retryNext.mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(409);
    expect(err.message).toContain("vérifiez le stock");
  });

  it("nouvelle intention, nouvelle clé : l'ajustement suivant s'exécute", async () => {
    const stuck = memoryStore();
    await stockGuard(stuck.store)(stockReq({ key: "k-1" }), fakeRes() as never, vi.fn());
    const fresh = memoryStore();
    const route = vi.fn();
    await stockGuard(fresh.store)(stockReq({ key: "k-2" }), fakeRes() as never, route);
    expect(route).toHaveBeenCalledWith();
  });
});

/**
 * Vrai routeur, cible envoyee par socket brut : la garde reconnait la route sur le chemin que le
 * routeur execute (`parseurl` convertit `\` en `/` avec un `#` ou une forme absolue), pas sur
 * `originalUrl` brut. Sinon la meme cle rejouerait l'ecriture au lieu de la reponse enregistree.
 */
describe("garde d'idempotence dans un vrai routeur Express", () => {
  const B = BACKSLASH;
  let server: http.Server;
  let port = 0;
  let executions = 0;
  let store: IdempotencyStore;

  beforeEach(async () => {
    executions = 0;
    store = memoryStore().store;
    const app = express();
    const apiRouter = express.Router();
    apiRouter.use(express.json());
    apiRouter.use((req, _res, next) => {
      (req as { session?: unknown }).session = { userId: 3 };
      next();
    });
    apiRouter.use(idempotencyGuard(ROUTES, store, async (id) => ({ id })));
    app.use("/api", apiRouter);
    // Declaree sur l'app apres apiRouter, comme les routes de `server/routes.ts`.
    app.put("/api/missions/:id/status", (_req, res) => {
      executions += 1;
      res.json({ ok: true, executions });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ["/api/missions/7/status", `/api${B}missions/7/status#x`],
    ["/api/missions/7/status", `http://h/api${B}missions/7/status`],
    ["/api/missions/7/status", `/api/missions${B}7/status#`],
    ["/api/missions/7/status", "/api/missions/7/status/"],
  ])("%s puis %s, meme cle : la route ne s'execute qu'une fois", async (first, second) => {
    const options = { body: { status: "in_progress" }, headers: { "Idempotency-Key": "k-raw" } };
    expect(await sendRaw(port, "PUT", first, options)).toBe(200);
    await flush();
    expect(await sendRaw(port, "PUT", second, options)).toBe(200);
    expect(executions).toBe(1);
    expect(store.reserve).toHaveBeenCalledTimes(2);
  });
});
