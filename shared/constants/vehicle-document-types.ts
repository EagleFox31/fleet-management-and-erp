/**
 * Types de document véhicule inscrits au démarrage (P-05).
 *
 * Le référentiel vit en base (`vehicle_document_types`) et grandit à chaud : un administrateur
 * crée des codes par `POST /api/vehicle-document-types`. Cette liste n'est donc **pas** la liste
 * complète des codes valides ; c'est la graine semée par `server/init-database.ts`
 * (`ON CONFLICT DO NOTHING`) et le jeu de codes que le code peut citer en dur.
 * `vehicle_documents.type` référence `vehicle_document_types(code)` (clé étrangère).
 */

export interface VehicleDocumentTypeSeed {
  code: string;
  label: string;
  /** `null` : pas de durée fixe, l'alerte suit la date d'expiration saisie. */
  validityMonths: number | null;
  alertDays: number;
  active: boolean;
  sortOrder: number;
}

export const VEHICLE_DOCUMENT_TYPE_SEED = [
  { code: "carte_grise", label: "Carte grise", validityMonths: 120, alertDays: 30, active: true, sortOrder: 10 },
  { code: "carte_bleue", label: "Carte bleue", validityMonths: 12, alertDays: 30, active: true, sortOrder: 20 },
  { code: "visite_technique", label: "Visite technique", validityMonths: 6, alertDays: 30, active: true, sortOrder: 30 },
  { code: "acf", label: "ACF", validityMonths: null, alertDays: 30, active: true, sortOrder: 40 },
  { code: "tae", label: "TAE", validityMonths: 6, alertDays: 30, active: true, sortOrder: 50 },
  { code: "vignette", label: "Vignette", validityMonths: 12, alertDays: 30, active: true, sortOrder: 60 },
  { code: "jaugeage", label: "Jaugeage", validityMonths: 24, alertDays: 30, active: true, sortOrder: 70 },
  { code: "assurance", label: "Assurance", validityMonths: 12, alertDays: 30, active: true, sortOrder: 80 },
  { code: "agrement_pd", label: "Agrément PD", validityMonths: null, alertDays: 30, active: true, sortOrder: 90 },
  { code: "taxe", label: "Taxe", validityMonths: null, alertDays: 30, active: true, sortOrder: 900 },
  { code: "autre", label: "Autre", validityMonths: null, alertDays: 30, active: true, sortOrder: 910 },
] as const satisfies readonly VehicleDocumentTypeSeed[];

/** Code connu du code source (graine). Un code créé à chaud reste un `string`. */
export type VehicleDocumentTypeCode = (typeof VEHICLE_DOCUMENT_TYPE_SEED)[number]["code"];

/**
 * Alias historiques vers les codes du référentiel. Source unique : tout écrivain de
 * `vehicle_documents` normalise le type reçu avant de le vérifier contre le référentiel.
 */
export const VEHICLE_DOCUMENT_TYPE_ALIASES: Readonly<Record<string, VehicleDocumentTypeCode>> = {
  insurance: "assurance",
  inspection: "visite_technique",
  technical_inspection: "visite_technique",
  controle_technique: "visite_technique",
  license: "carte_grise",
  registration: "carte_grise",
  registration_card: "carte_grise",
};

/** Minuscules, espaces retirés, alias résolu. Un code inconnu est rendu tel quel (le référentiel tranche). */
export function normalizeVehicleDocumentType(rawType: string | null | undefined): string {
  const normalized = String(rawType || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VEHICLE_DOCUMENT_TYPE_ALIASES, normalized)
    ? VEHICLE_DOCUMENT_TYPE_ALIASES[normalized]
    : normalized;
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Ordre SQL de la graine, sans point-virgule final. Texte identique à celui de
 * `server/db/migrations/20261031_lot_recette.sql` (comparé par tests/unit/server/lot-recette-schema-drift.test.ts).
 */
export function vehicleDocumentTypeSeedSql(): string {
  const rows = VEHICLE_DOCUMENT_TYPE_SEED.map(
    (t) =>
      `  (${sqlText(t.code)}, ${sqlText(t.label)}, ${t.validityMonths ?? "NULL"}, ${t.alertDays}, ${t.active}, ${t.sortOrder})`,
  );
  return [
    "INSERT INTO vehicle_document_types (code, label, validity_months, alert_days, active, sort_order) VALUES",
    rows.join(",\n"),
    "ON CONFLICT (code) DO NOTHING",
  ].join("\n");
}
