import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { STATUS_MESSAGES, describeIssue, looksTechnical } from "../../../shared/errors";
import { AppError, errorHandler, errorResponseGuard, normalizeErrorBody, toHttpError } from "../../../server/middleware/error-handler";
import { LAST_ADMIN_MESSAGE } from "../../../server/lib/last-admin-rule";
import { leakText } from "../../support/api-error";

/** Gestion d'erreurs centralisée, niveau U : contrat de réponse et absence de fuite. */

function fakeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
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
  return res;
}

const req = { requestId: "req-1", method: "POST", path: "/api/x" } as never;

describe("looksTechnical", () => {
  it.each([
    'relation "parts" does not exist',
    "TypeError: Cannot read properties of undefined",
    "duplicate key value violates unique constraint",
    "Expected number, received string",
    '{"code":"invalid_type"}',
    "connect ECONNREFUSED 127.0.0.1:5432",
  ])("repère « %s »", (text) => expect(looksTechnical(text)).toBe(true));

  it.each(["Stock insuffisant pour cette pièce", "La demande a déjà changé de statut. Rechargez la page."])(
    "laisse passer « %s »",
    (text) => expect(looksTechnical(text)).toBe(false),
  );
});

describe("describeIssue", () => {
  it("traduit les issues Zod courantes", () => {
    const result = z.object({ name: z.string().min(3), qty: z.number(), email: z.string().email() }).safeParse({ name: "a", email: "x" });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map(describeIssue);
    expect(messages).toEqual(["Saisissez au moins 3 caractères.", "Ce champ est obligatoire.", "Adresse e-mail invalide."]);
  });
});

describe("normalizeErrorBody", () => {
  it("une 500 ne laisse jamais passer le message d'origine", () => {
    const body = normalizeErrorBody(500, { error: 'column "foo" does not exist', stack: "at x.ts:1" }, "abc");
    expect(body).toEqual({ message: `${STATUS_MESSAGES.INTERNAL} Référence : abc.`, code: "INTERNAL", requestId: "abc" });
  });

  it("garde un message 4xx lisible et ajoute code + référence", () => {
    expect(normalizeErrorBody(403, { message: "Seul le magasin peut sortir une pièce" }, "r")).toEqual({
      message: "Seul le magasin peut sortir une pièce",
      code: "FORBIDDEN",
      requestId: "r",
    });
  });

  it("met les issues Zod historiques (`details`) en champs lisibles", () => {
    const body = normalizeErrorBody(400, {
      error: "Données invalides",
      details: [{ code: "invalid_type", path: ["supplierId"], received: "undefined", message: "Required" }],
    });
    expect(body.errors).toEqual([{ field: "supplierId", message: "Ce champ est obligatoire." }]);
    expect(body.message).toBe("Données invalides");
  });
});

describe("errorResponseGuard", () => {
  it("réécrit `res.status(500).json({ error: error.message })` des routes historiques", () => {
    const res = fakeRes();
    errorResponseGuard(req, res as never, vi.fn());
    res.status(500).json({ error: "null value in column \"name\"" });
    expect(res.body).toEqual({ message: `${STATUS_MESSAGES.INTERNAL} Référence : req-1.`, code: "INTERNAL", requestId: "req-1" });
  });

  it("laisse les réponses de succès intactes", () => {
    const res = fakeRes();
    errorResponseGuard(req, res as never, vi.fn());
    res.status(201).json({ id: 1 });
    expect(res.body).toEqual({ id: 1 });
  });
});

describe("toHttpError / errorHandler", () => {
  it("AppError garde son statut et son message", () => {
    expect(toHttpError(new AppError(409, "Déjà réceptionnée"))).toMatchObject({ status: 409, message: "Déjà réceptionnée" });
  });

  it("ZodError devient une 400 avec champs", () => {
    const result = z.object({ qty: z.number() }).safeParse({});
    if (result.success) throw new Error("attendu en échec");
    expect(toHttpError(result.error)).toEqual({ status: 400, fieldErrors: [{ field: "qty", message: "Ce champ est obligatoire." }] });
  });

  it("un JSON mal formé donne une 400 lisible", () => {
    expect(toHttpError({ type: "entity.parse.failed", status: 400 })).toMatchObject({ status: 400, message: "Les données envoyées sont illisibles." });
  });

  it("une exception inattendue devient une 500 sans détail", () => {
    const res = fakeRes();
    errorResponseGuard(req, res as never, vi.fn());
    errorHandler(new Error("boom: secret connection string"), req, res as never, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(leakText(res.body)).not.toMatch(/boom|secret/);
  });
});

describe("toHttpError : erreurs de base de données à traduire", () => {
  it("refus du trigger « dernier administrateur actif » : 400 au message lisible, sans détail technique", () => {
    const err = Object.assign(new Error("Il doit rester au moins un administrateur actif."), { code: "23514", constraint: "users_keep_one_active_admin" });
    expect(toHttpError(err)).toEqual({ status: 400, message: LAST_ADMIN_MESSAGE });
    expect(toHttpError({ cause: err })).toMatchObject({ status: 400 });
  });

  it("une autre contrainte CHECK n'est pas confondue avec celle-ci", () => {
    const err = Object.assign(new Error("x"), { code: "23514", constraint: "autre_check" });
    expect(toHttpError(err).status).toBe(500);
  });

  it.each(["40P01", "40001"])("transaction annulée (%s) : 409 à réessayer", (code) => {
    const err = Object.assign(new Error("deadlock detected"), { code });
    expect(toHttpError(err)).toEqual({ status: 409, message: "Opération en cours, réessayez." });
    expect(toHttpError({ cause: err })).toMatchObject({ status: 409 });
  });
});
