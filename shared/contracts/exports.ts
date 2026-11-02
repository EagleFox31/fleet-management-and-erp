/**
 * Exports (P-01) : qui peut télécharger quoi.
 *
 * Refus par défaut : un chemin absent de la matrice, ou un rôle absent de sa
 * ligne, reçoit 403. Le serveur pose ses gardes depuis cette matrice et le test
 * de contrat en génère ses cas : code et test ne peuvent pas diverger.
 *
 * `client`, `driver`, `technician` et `user` sont refusés partout. Un client
 * n'obtient pas « ses propres lignes » : aucun lien utilisateur → fiche client
 * n'existe encore (lot suivant). Drapeau coupé (`exports`) : 404.
 */
import { z } from "zod";
import { KPI_VIEWER_ROLES, type AppRole } from "../constants/roles";
import { kpiDateSchema, refineKpiPeriod } from "./kpi-period";

export const EXPORTS_BASE_PATH = "/api/exports";

export const EXPORT_PATHS = [
  "supplier-invoices",
  "inventory",
  "fuel-consumption",
  "fuel-statistics",
  "client-operations",
  "client-missions",
  "client-invoices",
  "monthly-report",
  // Rapport des indicateurs de pilotage (CDC #7), derrière le drapeau `kpi-reports`.
  "kpi-report",
  // Exports historiques servis par server/routes.ts (page Rapports) : memes regles de refus par defaut.
  "vehicles",
  "work-orders",
  "fuel",
  "users",
  "complete",
] as const;

export type ExportPath = (typeof EXPORT_PATHS)[number];

const FUEL_READERS = ["admin", "management", "secretary", "logistics", "workshop_manager"] as const satisfies readonly AppRole[];
const BILLING_READERS = ["admin", "management", "secretary", "logistics"] as const satisfies readonly AppRole[];

export const EXPORT_ROLE_MATRIX: Record<ExportPath, readonly AppRole[]> = {
  "supplier-invoices": ["admin", "management", "secretary", "logistics", "warehouse"],
  inventory: ["admin", "management", "secretary", "warehouse", "workshop_manager"],
  "fuel-consumption": FUEL_READERS,
  "fuel-statistics": FUEL_READERS,
  "client-operations": BILLING_READERS,
  "client-missions": BILLING_READERS,
  "client-invoices": BILLING_READERS,
  "monthly-report": ["admin", "management", "secretary"],
  "kpi-report": KPI_VIEWER_ROLES,
  vehicles: ["admin", "management", "secretary", "logistics", "workshop_manager"],
  "work-orders": ["admin", "management", "secretary", "workshop_manager"],
  fuel: FUEL_READERS,
  // Comptes utilisateurs et sauvegarde complete de la base : administrateur seul.
  users: ["admin"],
  complete: ["admin"],
};

export function isExportPath(value: string): value is ExportPath {
  return (EXPORT_PATHS as readonly string[]).includes(value);
}

export function canExport(role: string | null | undefined, path: string): boolean {
  if (!role || !isExportPath(path)) return false;
  return (EXPORT_ROLE_MATRIX[path] as readonly string[]).includes(role);
}

/** Rapport des indicateurs (`GET /api/exports/kpi-report`) : mensuel ou trimestriel, Excel par défaut. */
export const KPI_REPORT_PERIODS = ["month", "quarter"] as const;
export const KPI_REPORT_FORMATS = ["xlsx", "pdf"] as const;

export const kpiReportQuerySchema = z
  .object({
    period: z.enum(KPI_REPORT_PERIODS).default("month"),
    from: kpiDateSchema.optional(),
    to: kpiDateSchema.optional(),
    format: z.enum(KPI_REPORT_FORMATS).default("xlsx"),
  })
  .superRefine(refineKpiPeriod);

export type KpiReportQuery = z.infer<typeof kpiReportQuerySchema>;
