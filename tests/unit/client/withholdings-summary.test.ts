import { describe, expect, it } from "vitest";
import { defaultWithholdingsPeriod, isValidWithholdingsPeriod } from "@/components/finance/withholdings-summary";
import { LOT_SCREENS } from "@/config/lot-screens";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { FINANCE_RECEIVABLE_READ_ROLES } from "@shared/constants/roles";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";

describe("période par défaut des retenues", () => {
  it("va du premier du mois à aujourd'hui, jour calendaire de Douala", () => {
    // 31 octobre 23h30 UTC = 1er novembre 00h30 à Douala (UTC+1)
    expect(defaultWithholdingsPeriod(new Date("2026-10-31T23:30:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(defaultWithholdingsPeriod(new Date("2026-11-05T10:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });

  it("refuse une période vide ou inversée", () => {
    expect(isValidWithholdingsPeriod("2026-11-01", "2026-11-05")).toBe(true);
    expect(isValidWithholdingsPeriod("2026-11-05", "2026-11-05")).toBe(true);
    expect(isValidWithholdingsPeriod("2026-11-06", "2026-11-05")).toBe(false);
    expect(isValidWithholdingsPeriod("", "2026-11-05")).toBe(false);
  });
});

describe("écran des retenues à la source", () => {
  it("est ouvert aux rôles de lecture des créances, derrière le drapeau finance, avec menu", () => {
    const screen = LOT_SCREENS.find((s) => s.id === "finance-withholdings");
    expect(screen?.feature).toBe("finance");
    expect(screen?.roles).toBe(FINANCE_RECEIVABLE_READ_ROLES);
    expect(screen?.menu).toBeDefined();
  });

  it("est resynchronisé par les événements de dépôt et de taux de retenue", () => {
    for (const event of ["client_invoice_deposited", "client_withholding_updated"] as const) {
      expect(REALTIME_EVENTS[event]).toBeDefined();
      expect(satelliteTargetsOf(event).keys).toContain("/api/finance/withholdings");
    }
  });
});
