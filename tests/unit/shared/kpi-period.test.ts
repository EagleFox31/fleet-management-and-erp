import { afterEach, describe, expect, it, vi } from "vitest";
import { kpiReportQuerySchema } from "../../../shared/contracts/exports";
import { kpiQuerySchema, maintenanceCostsQuerySchema } from "../../../shared/contracts/kpi";
import {
  KPI_MAX_SPAN_MONTHS,
  KPI_TIME_ZONE,
  isoDateInZone,
  isRealCalendarDate,
  kpiPeriodIssue,
  kpiPeriodQuerySchema,
  spanInMonths,
} from "../../../shared/contracts/kpi-period";

/**
 * Période des KPI : une date hors calendrier ou une période démesurée
 * (`to=9999-12-30`) faisait boucler le calcul des mois avant une 500.
 */

describe("isRealCalendarDate", () => {
  it("accepte un jour qui existe, bissextile compris", () => {
    expect(isRealCalendarDate("2026-01-31")).toBe(true);
    expect(isRealCalendarDate("2024-02-29")).toBe(true);
  });

  it("refuse le 31 février, le 29 février hors bissextile, le mois 13 et le format libre", () => {
    for (const value of ["2026-02-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-1-1", "hier"]) {
      expect(isRealCalendarDate(value), value).toBe(false);
    }
  });
});

describe("spanInMonths", () => {
  it("compte les mois civils touchés, bornes incluses", () => {
    expect(spanInMonths("2026-03-05", "2026-03-20")).toBe(1);
    expect(spanInMonths("2026-01-31", "2026-02-01")).toBe(2);
    expect(spanInMonths("2024-01-01", "2026-12-31")).toBe(36);
  });
});

describe("kpiPeriodIssue", () => {
  it("laisse passer l'absence de borne, `to` seul ou une période de 36 mois", () => {
    expect(kpiPeriodIssue({})).toBeNull();
    expect(kpiPeriodIssue({ to: "2026-03-31" })).toBeNull();
    expect(kpiPeriodIssue({ from: "2024-01-01", to: "2026-12-31" })).toBeNull();
  });

  it("`from` seul : contrôlé jusqu'à aujourd'hui, comme le fait le serveur", () => {
    const today = "2026-11-02";
    expect(kpiPeriodIssue({ from: "2024-01-01" }, today)).toBeNull();
    const tooLong = kpiPeriodIssue({ from: "2001-01-01" }, today);
    expect(tooLong?.path).toBe("from");
    expect(tooLong?.message).toContain(String(KPI_MAX_SPAN_MONTHS));
    expect(kpiPeriodIssue({ from: "2027-01-01" }, today)?.path).toBe("from");
  });

  it("refuse une période inversée sur `from`, une période trop longue sur `to`", () => {
    expect(kpiPeriodIssue({ from: "2026-02-01", to: "2026-01-01" })?.path).toBe("from");
    const tooLong = kpiPeriodIssue({ from: "2024-01-01", to: "2027-01-01" });
    expect(tooLong?.path).toBe("to");
    expect(tooLong?.message).toContain(String(KPI_MAX_SPAN_MONTHS));
  });
});

describe("schémas de requête des KPI et du rapport", () => {
  const schemas = {
    kpiPeriodQuerySchema,
    kpiQuerySchema,
    maintenanceCostsQuerySchema,
    kpiReportQuerySchema,
  } as const;

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} : période démesurée, date inexistante ou année hors bornes refusées`, () => {
      for (const query of [
        { from: "2001-01-01", to: "9999-12-30" },
        { to: "2026-02-31" },
        { from: "1999-12-31" },
        { to: "2101-01-01" },
        { from: "2020-01-01", to: "2023-01-31" },
        { from: "2001-01-01" },
      ]) {
        expect(schema.safeParse(query).success, `${name} ${JSON.stringify(query)}`).toBe(false);
      }
    });

    it(`${name} : période ordinaire acceptée`, () => {
      expect(schema.safeParse({ from: "2026-01-01", to: "2026-03-31" }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(true);
    });
  }
});

describe("jour courant à Douala (UTC+1)", () => {
  afterEach(() => vi.useRealTimers());

  it("isoDateInZone lit le jour dans Africa/Douala, pas en UTC", () => {
    expect(KPI_TIME_ZONE).toBe("Africa/Douala");
    expect(isoDateInZone(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
    expect(isoDateInZone(new Date("2026-11-02T22:59:00Z"))).toBe("2026-11-02");
  });

  it("à 00:30 à Douala (23:30 UTC la veille), `from` = jour de Douala sans `to` est accepté", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T23:30:00Z"));
    expect(kpiPeriodQuerySchema.safeParse({ from: "2026-11-03" }).success).toBe(true);
    expect(kpiQuerySchema.safeParse({ from: "2026-11-03" }).success).toBe(true);
    // lendemain de Douala : toujours refusé
    expect(kpiPeriodQuerySchema.safeParse({ from: "2026-11-04" }).success).toBe(false);
  });
});
