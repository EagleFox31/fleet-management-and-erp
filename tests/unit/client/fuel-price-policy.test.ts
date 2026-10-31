import { describe, expect, it } from "vitest";
import { isFuelPriceImposed, localDateKey } from "../../../client/src/lib/fuel-price-policy";

describe("isFuelPriceImposed", () => {
  it("drapeau coupé : jamais imposé, saisie libre pour tous les rôles", () => {
    for (const role of ["driver", "logistics", "secretary", "admin", undefined]) {
      expect(isFuelPriceImposed(role, false)).toBe(false);
    }
  });

  it("drapeau actif : imposé hors admin et logistics", () => {
    expect(isFuelPriceImposed("driver", true)).toBe(true);
    expect(isFuelPriceImposed("secretary", true)).toBe(true);
    expect(isFuelPriceImposed(undefined, true)).toBe(true);
    expect(isFuelPriceImposed("admin", true)).toBe(false);
    expect(isFuelPriceImposed("logistics", true)).toBe(false);
  });
});

describe("localDateKey", () => {
  it("donne la date locale, pas la date UTC", () => {
    expect(localDateKey(new Date(2026, 9, 31, 0, 30))).toBe("2026-10-31");
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
