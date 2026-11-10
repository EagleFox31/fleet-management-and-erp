import { describe, expect, it } from "vitest";
import { AppError, toHttpError } from "../../../server/middleware/error-handler";
import { MONEY_LOCK_MESSAGES, moneyLockMessageOf } from "../../../server/lib/pg-errors";

/** Verrous d'argent (plein validé, facture émise, avoir) : un refus de base est un 409 lisible, jamais un 500. */

const pgRefusal = (constraint: string, code = "23514") => Object.assign(new Error("new row violates check constraint"), { code, constraint });

describe.each(Object.entries(MONEY_LOCK_MESSAGES))("verrou %s", (constraint, message) => {
  it("erreur pg brute : 409 et message lisible", () => {
    expect(toHttpError(pgRefusal(constraint))).toMatchObject({ status: 409, message });
  });

  it("AppError 500 enveloppant l'erreur pg : 409 et message lisible", () => {
    const wrapped = new AppError(500, "Erreur interne", { cause: pgRefusal(constraint) });
    expect(toHttpError(wrapped)).toMatchObject({ status: 409, message });
  });

  it("erreur pg dans la cause d'une erreur de Drizzle : trouvée", () => {
    expect(moneyLockMessageOf(new Error("Failed query", { cause: pgRefusal(constraint) }))).toBe(message);
  });
});

describe("verrous d'argent : cas hors périmètre", () => {
  it("messages attendus", () => {
    expect(MONEY_LOCK_MESSAGES.fuel_records_validated_locked).toBe("Ce plein est validé : il ne se modifie plus. Annulez-le avec un motif, puis saisissez-en un nouveau.");
    expect(MONEY_LOCK_MESSAGES.client_invoices_issued_locked).toBe("Cette facture est émise : ses montants ne se modifient plus. Établissez un avoir.");
    expect(MONEY_LOCK_MESSAGES.client_credit_notes_immutable).toBe("Un avoir émis ne se modifie pas.");
  });

  it("autre contrainte CHECK : inchangé", () => {
    expect(moneyLockMessageOf(pgRefusal("autre_check"))).toBeUndefined();
    expect(toHttpError(pgRefusal("autre_check")).status).toBe(500);
  });

  it("bon nom mais autre code (23505) : inchangé", () => {
    expect(moneyLockMessageOf(pgRefusal("client_invoices_issued_locked", "23505"))).toBeUndefined();
  });

  it("AppError 500 sans verrou : reste 500 ; AppError 4xx : conservée", () => {
    expect(toHttpError(new AppError(500, "x", { cause: new Error("boom") })).status).toBe(500);
    expect(toHttpError(new AppError(400, "Saisie invalide"))).toMatchObject({ status: 400, message: "Saisie invalide" });
  });

  it("AppError 4xx dont la cause est un verrou : statut et message de l'AppError conservés", () => {
    const e = new AppError(422, "Montant refusé", { cause: pgRefusal("client_invoices_issued_locked") });
    expect(toHttpError(e)).toMatchObject({ status: 422, message: "Montant refusé" });
  });
});
