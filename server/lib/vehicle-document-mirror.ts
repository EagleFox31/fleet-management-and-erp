import { and, eq, isNull, or, sql } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { db } from "../db";

/** Normalise les anciens codes de type de document vers ceux de `vehicle_documents`. */
export function normalizeVehicleDocumentType(rawType: string | null | undefined): string {
  const normalized = String(rawType || "").trim().toLowerCase();
  switch (normalized) {
    case "insurance":
      return "assurance";
    case "inspection":
    case "technical_inspection":
    case "controle_technique":
      return "visite_technique";
    case "license":
    case "registration":
    case "registration_card":
      return "carte_grise";
    default:
      return normalized;
  }
}

export type MirrorMode =
  /** Dépôt d'un document : le miroir ne recule jamais (GREATEST). */
  | "later"
  /** Correction ou renouvellement explicite d'une date : écriture directe. */
  | "set";

const MIRROR_COLUMNS = {
  carte_grise: { column: vehicles.licensePlateExpiry, key: "licensePlateExpiry" },
  assurance: { column: vehicles.insuranceExpiry, key: "insuranceExpiry" },
  visite_technique: { column: vehicles.technicalInspectionDate, key: "technicalInspectionDate" },
} as const;

/**
 * `vehicle_documents` fait foi ; les colonnes `vehicles.*` en sont le miroir lu par
 * l'éligibilité mission et par les alertes. À appeler après tout dépôt ou changement
 * de date d'un document. Sans date, ou pour un type sans miroir, ne fait rien.
 * Renvoie `true` si la colonne miroir a changé (mode `later` : seulement si la date avance ;
 * mode `set` : dès qu'une écriture a lieu).
 */
export async function syncVehicleDocumentMirror(
  vehicleId: number,
  documentType: string | null | undefined,
  expiryDate: string | Date | null | undefined,
  mode: MirrorMode,
): Promise<boolean> {
  if (!expiryDate) return false;
  const value = expiryDate instanceof Date ? expiryDate.toISOString().slice(0, 10) : expiryDate;
  const type = normalizeVehicleDocumentType(documentType);
  if (!(type in MIRROR_COLUMNS)) return false;
  const { column, key } = MIRROR_COLUMNS[type as keyof typeof MIRROR_COLUMNS];
  if (mode === "set") {
    await db.update(vehicles).set({ [key]: value }).where(eq(vehicles.id, vehicleId));
    return true;
  }
  // Dépôt : la colonne n'avance que si la date est plus récente (équivalent de GREATEST).
  const advanced = await db
    .update(vehicles)
    .set({ [key]: value })
    .where(and(eq(vehicles.id, vehicleId), or(isNull(column), sql`${column} < ${value}::date`)))
    .returning({ id: vehicles.id });
  return advanced.length > 0;
}
