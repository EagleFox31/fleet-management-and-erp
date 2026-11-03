import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un seul log par erreur (AGENTS.md §10). Une erreur relayée par `next(err)` est journalisée par
 * `errorHandler`, une seule fois : la garde de sortie ne la rejournalise pas, et le contexte que la
 * route attachait à son propre log (`withLogContext`) se retrouve dans cette ligne unique.
 */

const spy = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../../../server/lib/logger", () => ({
  logger: spy,
  moduleLogger: () => spy,
}));

import { AppError, errorHandler, errorResponseGuard } from "../../../server/middleware/error-handler";
import { logContextOf, withLogContext } from "../../../server/lib/error-log-context";
import { makeFailWith } from "../../../server/lib/route-helpers";
import { moduleLogger } from "../../../server/lib/logger";

function fakeRes() {
  return {
    statusCode: 200,
    headersSent: false,
    locals: {} as Record<string, unknown>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

const req = { requestId: "req-1", method: "GET", path: "/api/drivers" } as never;

/** Chaîne réelle : la garde enveloppe `res.json`, puis `errorHandler` répond. */
function relay(err: unknown) {
  const res = fakeRes();
  errorResponseGuard(req, res as never, () => {});
  errorHandler(err, req, res as never, () => {});
  return res;
}

beforeEach(() => {
  spy.error.mockClear();
  spy.warn.mockClear();
});

describe("journal unique d'une erreur relayée", () => {
  it("5xx relayée avec contexte : une seule ligne error, event et champs de la route conservés", () => {
    const err = withLogContext(new AppError(500, "Impossible de charger les chauffeurs.", { cause: new Error("db down") }), {
      event: "Liste des chauffeurs en echec",
      driverId: 42,
    });
    const res = relay(err);

    expect(res.statusCode).toBe(500);
    expect(spy.error).toHaveBeenCalledTimes(1);
    const [context] = spy.error.mock.calls[0];
    expect(context).toMatchObject({ event: "Liste des chauffeurs en echec", driverId: 42, requestId: "req-1", status: 500 });
    expect(context.err).toBe(err);
  });

  it("5xx relayée sans contexte : une seule ligne error", () => {
    relay(new Error("boom"));
    expect(spy.error).toHaveBeenCalledTimes(1);
  });

  it("4xx relayée : un warn, aucun error", () => {
    relay(withLogContext(new AppError(403, "Accès refusé"), { event: "refus" }));
    expect(spy.error).not.toHaveBeenCalled();
    expect(spy.warn).toHaveBeenCalledTimes(1);
    expect(spy.warn.mock.calls[0][0]).toMatchObject({ event: "refus", status: 403 });
  });

  it("erreur après envoi des en-têtes : une ligne error avec contexte, connexion fermée sans relais à Express", () => {
    const res = { ...fakeRes(), headersSent: true, statusCode: 200, destroy: vi.fn() };
    const next = vi.fn();
    const err = withLogContext(new Error("flux coupé"), { event: "Export en echec", exportId: 7 });
    errorHandler(err, req, res as never, next);
    expect(spy.error).toHaveBeenCalledTimes(1);
    expect(spy.error.mock.calls[0][0]).toMatchObject({ event: "Export en echec", exportId: 7, requestId: "req-1", status: 200 });
    // `next(err)` ferait écrire au finalhandler d'Express une seconde trace, sans requestId.
    expect(next).not.toHaveBeenCalled();
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
  });

  it("makeFailWith : aucune ligne propre, le contexte du routeur passe dans la ligne unique", () => {
    const failWith = makeFailWith(moduleLogger("drivers"));
    let relayed: unknown;
    failWith(new Error("db down"), req, (e?: unknown) => { relayed = e; }, "Liste des chauffeurs en echec");
    expect(spy.error).not.toHaveBeenCalled();
    relay(relayed);
    expect(spy.error).toHaveBeenCalledTimes(1);
    expect(spy.error.mock.calls[0][0]).toMatchObject({ event: "Liste des chauffeurs en echec", status: 500 });
  });

  it("route historique qui répond 500 elle-même : la garde garde son log (aucune perte)", () => {
    const res = fakeRes();
    errorResponseGuard(req, res as never, () => {});
    res.status(500).json({ error: "x" });
    expect(spy.error).toHaveBeenCalledTimes(1);
  });
});

describe("withLogContext", () => {
  it("enveloppe une valeur non objet dans une AppError 500", () => {
    const wrapped = withLogContext("chaîne levée", { event: "e" });
    expect(wrapped).toBeInstanceOf(AppError);
    expect(logContextOf(wrapped)).toEqual({ event: "e" });
  });

  it("un second appel complète sans écraser le premier event", () => {
    const err = new Error("x");
    withLogContext(err, { event: "première", a: 1 });
    withLogContext(err, { event: "seconde", b: 2 });
    expect(logContextOf(err)).toEqual({ event: "première", a: 1, b: 2 });
  });
});
