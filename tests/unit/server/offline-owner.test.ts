import { describe, expect, it } from "vitest";
import { offlineOwnerMismatch, ownerHeaderMatches } from "../../../server/lib/offline-owner";
import { OFFLINE_OWNER_HEADER } from "../../../server/lib/idempotency-config";

const withOwner = (value: string | undefined) => ({
  get: (name: string) => (name.toLowerCase() === OFFLINE_OWNER_HEADER.toLowerCase() ? value : undefined),
});

describe("ownerHeaderMatches", () => {
  it("accepte la forme valide égale à la session", () => {
    expect(ownerHeaderMatches(withOwner("7"), 7)).toBe(true);
  });

  it("refuse un autre compte", () => {
    expect(ownerHeaderMatches(withOwner("8"), 7)).toBe(false);
  });

  it("tolère les espaces de bord", () => {
    expect(ownerHeaderMatches(withOwner(" 7 "), 7)).toBe(true);
  });

  it("refuse une liste (en-tête répété joint par Node)", () => {
    expect(ownerHeaderMatches(withOwner("1, 2"), 1)).toBe(false);
    expect(ownerHeaderMatches(withOwner("1, 2"), 2)).toBe(false);
  });

  it("refuse un en-tête vide ou blanc", () => {
    expect(ownerHeaderMatches(withOwner(""), 0)).toBe(false);
    expect(ownerHeaderMatches(withOwner("   "), 7)).toBe(false);
  });

  it("refuse une forme non entière", () => {
    for (const v of ["7.0", "-7", "0x7", "7a", "1e1", "1234567890"]) expect(ownerHeaderMatches(withOwner(v), Number(v) || 7)).toBe(false);
  });

  it("faux sans en-tête ou sans session", () => {
    expect(ownerHeaderMatches(withOwner(undefined), 7)).toBe(false);
    expect(ownerHeaderMatches(withOwner("7"), undefined)).toBe(false);
    expect(ownerHeaderMatches(withOwner("7"), null)).toBe(false);
  });
});

describe("offlineOwnerMismatch", () => {
  it("409 OFFLINE_OWNER_MISMATCH avec un message lisible", () => {
    const err = offlineOwnerMismatch();
    expect(err.status).toBe(409);
    expect(err.code).toBe("OFFLINE_OWNER_MISMATCH");
    expect(err.message).toMatch(/autre compte/);
  });
});
