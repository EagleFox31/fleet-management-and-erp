import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "@shared/feature-flags";
import { defaultFeatureFlags } from "@/hooks/use-feature";
import { NEXT_LOTS, featuresByLevel } from "@/lib/scope-overview";

describe("page périmètre", () => {
  const flags = defaultFeatureFlags();

  it("les fonctions en essai sont celles du niveau should, libellés du catalogue", () => {
    const trial = featuresByLevel("should", flags);
    expect(trial.length).toBeGreaterThan(0);
    for (const f of trial) {
      expect(FEATURE_FLAGS[f.key].level).toBe("should");
      expect(f.label).toBe(FEATURE_FLAGS[f.key].label);
      expect(f.enabled).toBe(FEATURE_FLAGS[f.key].defaultEnabled);
    }
  });

  it("l'état suit les drapeaux effectifs", () => {
    const on = featuresByLevel("should", { ...flags, incidents: true });
    expect(on.find((f) => f.key === "incidents")?.enabled).toBe(true);
  });

  it("finance, QHSE, GPS et tarifs ne sont ni livrés ni en essai", () => {
    const shown = [...featuresByLevel("must", flags), ...featuresByLevel("should", flags)].map((f) => f.key);
    for (const key of ["finance", "qhse", "gps", "pricing"] as const) expect(shown).not.toContain(key);
  });

  it("chaque prochain lot dit pourquoi et ce qu'il faut", () => {
    for (const lot of NEXT_LOTS) {
      expect(lot.reason.length).toBeGreaterThan(0);
      expect(lot.need.length).toBeGreaterThan(0);
    }
  });
});
