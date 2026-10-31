import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, FEATURE_KEYS } from "@shared/feature-flags";
import { defaultFeatureFlags, resolveClientFeatureFlags } from "@/hooks/use-feature";
import { LOT_SCREENS, canAccessLotScreen } from "@/config/lot-screens";

describe("drapeaux côté client", () => {
  it("avant toute réponse, ce sont les défauts du catalogue", () => {
    const flags = resolveClientFeatureFlags(undefined);
    for (const key of FEATURE_KEYS) expect(flags[key]).toBe(FEATURE_FLAGS[key].defaultEnabled);
    expect(flags).toEqual(defaultFeatureFlags());
  });

  it("finance, qhse, gps et pricing sont coupés par défaut", () => {
    const flags = resolveClientFeatureFlags(undefined);
    for (const key of ["finance", "qhse", "gps", "pricing"] as const) expect(flags[key]).toBe(false);
  });

  it("la réponse du serveur l'emporte, les clés absentes gardent leur défaut", () => {
    const flags = resolveClientFeatureFlags({ incidents: true, exports: false });
    expect(flags.incidents).toBe(true);
    expect(flags.exports).toBe(false);
    expect(flags.finance).toBe(false);
  });

  it("une réponse invalide est ignorée sans lever", () => {
    expect(resolveClientFeatureFlags({ incidents: "oui" })).toEqual(defaultFeatureFlags());
    expect(resolveClientFeatureFlags("x")).toEqual(defaultFeatureFlags());
  });
});

describe("écrans du lot", () => {
  it("ids et chemins uniques", () => {
    expect(new Set(LOT_SCREENS.map((s) => s.id)).size).toBe(LOT_SCREENS.length);
    expect(new Set(LOT_SCREENS.map((s) => s.path)).size).toBe(LOT_SCREENS.length);
  });

  it("l'accès respecte les rôles", () => {
    const locked = LOT_SCREENS.find((s) => s.id === "admin-locked-users")!;
    expect(canAccessLotScreen(locked, "admin")).toBe(true);
    expect(canAccessLotScreen(locked, "technician")).toBe(false);
  });
});
