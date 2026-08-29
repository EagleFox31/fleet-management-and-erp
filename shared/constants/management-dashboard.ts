import type { ManagementExecutiveKpis } from "./management-executive-kpis";
import type { ManagementMissionProfitability } from "./management-mission-profitability";
import type { ManagementVehicleTco } from "./management-vehicle-tco";
import type { ManagementDriverScorecard } from "./management-driver-scorecard";
import type { ManagementVehicleObsolescence } from "./management-vehicle-obsolescence";
import type { LiveCorridorVehicle } from "./cemac-corridors";

export type {
  ManagementExecutiveKpis,
  ManagementMissionProfitability,
  ManagementVehicleTco,
  ManagementDriverScorecard,
  ManagementVehicleObsolescence,
  LiveCorridorVehicle,
};
export type { ManagementMissionProfitabilityItem } from "./management-mission-profitability";
export type { ManagementVehicleTcoItem } from "./management-vehicle-tco";
export type { ManagementDriverScorecardItem } from "./management-driver-scorecard";
export type { ManagementVehicleObsolescenceItem } from "./management-vehicle-obsolescence";

export const MANAGEMENT_PERIODS = ["week", "month", "quarter", "year"] as const;

export type ManagementPeriod = (typeof MANAGEMENT_PERIODS)[number];

export const MANAGEMENT_PERIOD_LABELS: Record<ManagementPeriod, string> = {
  week: "7 jours",
  month: "Ce mois",
  quarter: "Trimestre",
  year: "Cette année",
};

export const MANAGEMENT_PREVIOUS_PERIOD_LABELS: Record<ManagementPeriod, string> = {
  week: "7 jours précédents",
  month: "Mois précédent",
  quarter: "Trimestre précédent",
  year: "Année précédente",
};

export function resolveManagementPeriodStart(period: ManagementPeriod, reference = new Date()): Date {
  const now = new Date(reference);

  switch (period) {
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "quarter": {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), quarterStartMonth, 1);
    }
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

export function resolvePeriodRange(
  period: ManagementPeriod,
  reference = new Date(),
): { start: Date; end: Date } {
  return {
    start: resolveManagementPeriodStart(period, reference),
    end: new Date(reference),
  };
}

export function resolvePreviousPeriodRange(
  period: ManagementPeriod,
  reference = new Date(),
): { start: Date; end: Date } {
  const now = new Date(reference);

  switch (period) {
    case "week": {
      const currentStart = resolveManagementPeriodStart("week", reference);
      const end = new Date(currentStart.getTime() - 1);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000 + 1);
      return { start, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "quarter": {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
      const end = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "year": {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
    default:
      return resolvePreviousPeriodRange("month", reference);
  }
}

export function toIsoDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Extrait un libellé lisible depuis `missions.cargo` (jsonb). */
export function extractCargoLabel(cargo: unknown): string {
  if (cargo == null) {
    return "Non renseigné";
  }

  if (typeof cargo === "string") {
    const trimmed = cargo.trim();
    return trimmed.length > 0 ? trimmed : "Non renseigné";
  }

  if (typeof cargo === "object") {
    const record = cargo as Record<string, unknown>;
    for (const key of ["description", "type", "label", "name", "category"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  return "Non renseigné";
}

export function computeTrendPercent(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type ManagementTrendDirection = "up" | "down" | "flat";

export function resolveTrendDirection(
  percent: number | null,
  higherIsBetter = true,
): ManagementTrendDirection {
  if (percent == null || Math.abs(percent) < 0.05) {
    return "flat";
  }
  const improved = higherIsBetter ? percent > 0 : percent < 0;
  return improved ? "up" : "down";
}

export type ManagementDashboardTrends = {
  previousPeriodLabel: string;
  revenueTTC: number | null;
  expensesTotal: number | null;
  grossHT: number | null;
  marginPercent: number | null;
};

export type ManagementDashboardResponse = {
  period: ManagementPeriod;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  revenue: {
    invoicedHT: number;
    invoicedTTC: number;
    collectedTTC: number;
    outstandingTTC: number;
    invoiceCount: number;
  };
  expenses: {
    fuel: number;
    maintenance: number;
    suppliers: number;
    /** FDR réels missions (`workflowData.costs.actualFdrCost`) sur la période. */
    roadExpenses: number;
    roadExpensesMissionCount: number;
    roadExpensesMissingCount: number;
    total: number;
  };
  result: {
    grossHT: number;
    marginPercent: number;
  };
  fleet: {
    operational: number;
    maintenance: number;
    outOfService: number;
    total: number;
  };
  topClients: Array<{
    clientName: string;
    invoicedTTC: number;
    collectedTTC: number;
    invoiceCount: number;
  }>;
  topDestinations: Array<{
    destination: string;
    missionCount: number;
    fuelCost: number;
  }>;
  topCargoTypes: Array<{
    cargoLabel: string;
    missionCount: number;
    fuelCost: number;
    totalWeight: number;
  }>;
  trends: ManagementDashboardTrends;
  executiveKpis: ManagementExecutiveKpis;
  missionProfitability: ManagementMissionProfitability;
  vehicleTco: ManagementVehicleTco;
  driverScorecard: ManagementDriverScorecard;
  vehicleObsolescence: ManagementVehicleObsolescence;
  corridorFleet: LiveCorridorVehicle[];
  alerts: {
    overdueInvoices: number;
    outOfServiceVehicles: number;
    vehiclesImmobilizedOver48h: number;
  };
};
