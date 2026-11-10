/**
 * Drapeaux de fonctionnalité du lot recette (ADR 0001 §6).
 *
 * Seule source des clés : une clé absente d'ici n'existe pas. Le serveur
 * résout les valeurs par défaut, surchargées par la variable d'environnement
 * `FEATURE_FLAGS` (`incidents=on,fuel-prices=off`) ; une route derrière un
 * drapeau coupé répond 404. Le client lit `GET /api/feature-flags`.
 *
 * Niveaux : `must` allumé (coupe-circuit), `should` coupé jusqu'à validation
 * en répétition, `later` coupé et masqué.
 */
import { z } from "zod";

export type FeatureLevel = "must" | "should" | "later";

export type FeatureFlagDefinition = {
  level: FeatureLevel;
  defaultEnabled: boolean;
  label: string;
};

export const FEATURE_FLAGS = {
  exports: { level: "must", defaultEnabled: true, label: "Exports PDF, Excel et Word" },

  "work-order-audit-trail": { level: "should", defaultEnabled: false, label: "Historique d'un ordre de travail" },
  "vehicle-cost-summary": { level: "should", defaultEnabled: false, label: "Coût d'un véhicule" },
  "tire-movements": { level: "should", defaultEnabled: true, label: "Mouvements de pneus" },
  "part-requirement-receive": { level: "should", defaultEnabled: false, label: "Réception signée des pièces" },
  "fuel-vouchers": { level: "should", defaultEnabled: false, label: "Validation des bons de carburant" },
  "fuel-anomalies": { level: "should", defaultEnabled: true, label: "Traitement des anomalies carburant" },
  "fuel-prices": { level: "should", defaultEnabled: false, label: "Prix du carburant daté" },
  "time-tracking": { level: "should", defaultEnabled: false, label: "Pointage" },
  "operations-tracking": { level: "should", defaultEnabled: false, label: "Suivi des opérations clients" },
  "pending-invoices": { level: "should", defaultEnabled: false, label: "Factures en attente" },
  incidents: { level: "should", defaultEnabled: true, label: "Déclaration de panne" },
  "oil-change-prefill": { level: "should", defaultEnabled: false, label: "Intervalles de vidange préremplis" },
  "quality-check": { level: "should", defaultEnabled: false, label: "Contrôle qualité des ordres de travail" },

  // Écarts du cahier des charges (chantier CDC, lot CDC-0a). Coupés jusqu'à validation en répétition.
  "mission-maintenance-advisory": { level: "should", defaultEnabled: false, label: "Avis de maintenance sur mission" },
  "part-qr": { level: "should", defaultEnabled: false, label: "Étiquettes et scan QR des pièces" },
  "part-sales": { level: "should", defaultEnabled: false, label: "Vente de pièces" },
  "kpi-reports": { level: "should", defaultEnabled: false, label: "Rapports d'indicateurs" },
  "maintenance-report": { level: "should", defaultEnabled: false, label: "Rapport de maintenance" },
  "excel-import": { level: "should", defaultEnabled: false, label: "Import Excel" },
  "technician-offline": { level: "should", defaultEnabled: false, label: "Saisie hors ligne du technicien" },
  // Protection serveur contre les doublons des écritures rejouées (lot #10b), indépendante du rôle.
  // Un drapeau d'écran hors ligne (technician-offline, driver-offline) exige celui-ci.
  "offline-writes": { level: "should", defaultEnabled: false, label: "Écritures rejouables sans doublon" },

  "email-notifications": { level: "later", defaultEnabled: false, label: "Alertes par e-mail" },
  finance: { level: "later", defaultEnabled: false, label: "Trésorerie et recouvrement" },
  "report-schedules": { level: "later", defaultEnabled: false, label: "Envoi automatique des rapports" },
  qhse: { level: "later", defaultEnabled: false, label: "QHSE" },
  gps: { level: "later", defaultEnabled: false, label: "Suivi GPS" },
  pricing: { level: "later", defaultEnabled: false, label: "Tarifs" },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureKey = keyof typeof FEATURE_FLAGS;

export const FEATURE_KEYS = Object.keys(FEATURE_FLAGS) as FeatureKey[];

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, value);
}

export const FEATURE_FLAGS_PATH = "/api/feature-flags";

export const featureFlagsResponseSchema = z.record(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]), z.boolean());

export type FeatureFlagsResponse = Record<FeatureKey, boolean>;

export type FeatureOverrideParse = {
  overrides: Partial<Record<FeatureKey, boolean>>;
  /** Entrées ignorées (clé inconnue ou valeur illisible), à journaliser par l'appelant. */
  ignored: string[];
};

const ON_VALUES = new Set(["on", "true", "1"]);
const OFF_VALUES = new Set(["off", "false", "0"]);

/** Lit `incidents=on,fuel-prices=off`. Ne lève jamais : une entrée invalide est ignorée et rapportée. */
export function parseFeatureOverrides(raw: string | undefined | null): FeatureOverrideParse {
  const result: FeatureOverrideParse = { overrides: {}, ignored: [] };
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [key, value = ""] = trimmed.split("=").map((part) => part.trim());
    const normalized = value.toLowerCase();
    if (!isFeatureKey(key) || (!ON_VALUES.has(normalized) && !OFF_VALUES.has(normalized))) {
      result.ignored.push(trimmed);
      continue;
    }
    result.overrides[key] = ON_VALUES.has(normalized);
  }
  return result;
}

/** Valeurs effectives : défauts, puis surcharges. */
export function resolveFeatureFlags(raw?: string | null): FeatureFlagsResponse {
  const { overrides } = parseFeatureOverrides(raw);
  const resolved = {} as FeatureFlagsResponse;
  for (const key of FEATURE_KEYS) {
    resolved[key] = overrides[key] ?? FEATURE_FLAGS[key].defaultEnabled;
  }
  return resolved;
}
