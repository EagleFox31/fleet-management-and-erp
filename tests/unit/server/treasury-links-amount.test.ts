import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));

const { toTreasuryAmount } = await import("../../../server/services/treasury-links");

describe("montant d'une écriture liée (plein, recharge, règlement)", () => {
  it("ramène à deux décimales une valeur numeric lue en base, chaîne ou nombre", () => {
    expect(toTreasuryAmount("1250")).toBe("1250.00");
    expect(toTreasuryAmount("10.5")).toBe("10.50");
    expect(toTreasuryAmount(0.3)).toBe("0.30");
    expect(toTreasuryAmount("9999999999999.99")).toBe("9999999999999.99");
  });

  it("rien à écrire pour un montant nul, négatif, absent ou illisible", () => {
    for (const value of [0, "0.00", "0.004", -5, null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toTreasuryAmount(value), String(value)).toBeNull();
    }
  });
});
