import { describe, expect, it } from "vitest";
import { isExpiredOn, toExpiryDateOnly } from "../../../shared/constants/expiry-day";

// Relecture #143 (réserve 2) : une date au bon format mais impossible ne doit jamais
// produire NaN en aval ; elle est illisible (null), et le lancement de mission la bloque.
describe("toExpiryDateOnly : date impossible", () => {
  it.each(["2026-02-30", "2026-13-45", "2026-00-10", "2025-02-29"])("%s est illisible", (value) => {
    expect(toExpiryDateOnly(value)).toBeNull();
  });

  it("une date réelle reste lue, avec ou sans heure", () => {
    expect(toExpiryDateOnly("2024-02-29")).toBe("2024-02-29");
    expect(toExpiryDateOnly("2026-11-03T15:00:00.000Z")).toBe("2026-11-03");
  });

  it("isExpiredOn ne compare jamais une date impossible", () => {
    expect(isExpiredOn("2026-13-45", "2026-11-03")).toBe(false);
  });
});
