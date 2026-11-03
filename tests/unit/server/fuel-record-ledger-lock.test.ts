import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { assertFuelRecordLedgerEditable, changedLedgerFields, hasMovedFuelCard } from "../../../server/lib/fuel-record-ledger-lock";

const debited = { vehicleId: 7, date: "2026-01-15", quantity: 100, cost: "82800.00", debitAmount: "82800.00", creditAmount: "0" };

describe("verrou comptable d'un plein", () => {
  it("un plein mouvemente la carte s'il porte un débit ou un crédit non nul", () => {
    expect(hasMovedFuelCard(debited)).toBe(true);
    expect(hasMovedFuelCard({ debitAmount: "0", creditAmount: "50000" })).toBe(true);
    expect(hasMovedFuelCard({ debitAmount: null, creditAmount: null })).toBe(false);
    expect(hasMovedFuelCard({ debitAmount: "0.00", creditAmount: "0" })).toBe(false);
  });

  it("valeurs normalisées : nombre contre texte, date ISO du même jour, champ absent", () => {
    expect(changedLedgerFields(debited, { quantity: "100", cost: 82800, vehicleId: 7, date: "2026-01-15T00:00:00.000Z" })).toEqual([]);
    expect(changedLedgerFields(debited, {})).toEqual([]);
  });

  it("nomme chaque champ réellement changé", () => {
    expect(changedLedgerFields(debited, { quantity: 99, cost: "82800", date: "2026-01-16" })).toEqual(["date", "quantity"]);
  });

  it("409 sur un plein débité, sans détail technique dans le corps", () => {
    expect(() => assertFuelRecordLedgerEditable(debited, { cost: 1 })).toThrow(AppError);
    try {
      assertFuelRecordLedgerEditable(debited, { cost: 1 });
    } catch (err) {
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).details).toBeUndefined();
    }
  });

  it("plein débité : un écart d'arrondi garde la valeur stockée (pas de dérive des litres)", () => {
    const kept = assertFuelRecordLedgerEditable(debited, { quantity: 100.004, cost: 82800.004, notes: "n", mileage: 5 });
    expect(kept).toEqual({ notes: "n", mileage: 5 });
  });

  it("plein manuel : correctif transmis tel quel", () => {
    const patch = { cost: 1, quantity: 2 };
    expect(assertFuelRecordLedgerEditable({ ...debited, debitAmount: null }, patch)).toEqual(patch);
  });
});
