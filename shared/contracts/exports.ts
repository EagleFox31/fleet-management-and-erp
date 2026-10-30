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
import type { AppRole } from "../constants/roles";

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
};

export function isExportPath(value: string): value is ExportPath {
  return (EXPORT_PATHS as readonly string[]).includes(value);
}

export function canExport(role: string | null | undefined, path: string): boolean {
  if (!role || !isExportPath(path)) return false;
  return (EXPORT_ROLE_MATRIX[path] as readonly string[]).includes(role);
}
