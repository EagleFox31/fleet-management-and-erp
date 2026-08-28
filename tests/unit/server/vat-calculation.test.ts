import { describe, it, expect } from "vitest";
import { calculateVAT } from "../../../server/services/vat-calculation";

describe("calculateVAT", () => {
  it("calcule la TVA à 19.25%", () => {
    const result = calculateVAT(100000);

    expect(result.amountHT).toBe(100000);
    expect(result.vatRate).toBe(19.25);
    expect(result.vatAmount).toBe(19250);
    expect(result.totalTTC).toBe(119250);
  });

  it("arrondit les montants", () => {
    const result = calculateVAT(123456.78);

    expect(result.amountHT).toBeCloseTo(123456.78, 2);
    expect(Number.isInteger(result.vatAmount)).toBe(true);
    expect(Number.isInteger(result.totalTTC)).toBe(true);
    expect(result.totalTTC).toBeGreaterThan(result.amountHT);
  });

  it("gère un montant à 0", () => {
    const result = calculateVAT(0);

    expect(result.amountHT).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.totalTTC).toBe(0);
  });
});
