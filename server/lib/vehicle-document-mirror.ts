import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { vehicleDocuments, vehicles } from "@shared/schema";
import { db } from "../db";
import { toExpiryDateOnly } from "@shared/constants/expiry-day";

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

/**
 * Après la suppression d'un document : recale le miroir sur la plus lointaine échéance des
 * documents restants du même type (alias de type compris). Le dépôt ne fait qu'avancer
 * (GREATEST), donc sans ce recalcul un document saisi par erreur (2062) puis supprimé
 * laisserait le véhicule éligible.
 * Choix : la colonne n'est recalée que si elle porte exactement la date du document supprimé,
 * c'est-à-dire si c'est lui qui la fixait. Sinon elle vient d'un autre document ou d'une
 * saisie directe sur le véhicule, et on n'y touche pas. De même s'il ne reste aucun document
 * daté de ce type : rien ne permet de savoir quelle valeur était la bonne (limite connue,
 * corriger la date sur la fiche véhicule). La condition est portée par l'UPDATE lui-même, donc
 * un dépôt concurrent qui a déjà avancé la colonne n'est pas écrasé.
 * Renvoie `true` si la colonne a changé.
 */
export async function recomputeVehicleDocumentMirror(
  vehicleId: number,
  documentType: string | null | undefined,
  removedExpiryDate: string | Date | null | undefined,
): Promise<boolean> {
  if (!removedExpiryDate) return false;
  const removed =
    removedExpiryDate instanceof Date ? removedExpiryDate.toISOString().slice(0, 10) : String(removedExpiryDate).slice(0, 10);
  const type = normalizeVehicleDocumentType(documentType);
  if (!(type in MIRROR_COLUMNS)) return false;
  const { column, key } = MIRROR_COLUMNS[type as keyof typeof MIRROR_COLUMNS];
  const remaining = await db
    .select({ type: vehicleDocuments.type, expiryDate: vehicleDocuments.expiryDate })
    .from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.vehicleId, vehicleId), isNotNull(vehicleDocuments.expiryDate)));
  const dates = remaining
    .filter((row) => normalizeVehicleDocumentType(row.type) === type && row.expiryDate)
    .map((row) => toExpiryDateOnly(row.expiryDate))
    .filter((d): d is string => d !== null);
  if (dates.length === 0) return false;
  const latest = dates.reduce((a, b) => (a >= b ? a : b));
  const changed = await db
    .update(vehicles)
    .set({ [key]: latest })
    .where(
      and(
        eq(vehicles.id, vehicleId),
        sql`${column} = ${removed}::date`,
        sql`${column} <> ${latest}::date`,
      ),
    )
    .returning({ id: vehicles.id });
  return changed.length > 0;
}

/**
 * Après la correction de la date d'un document : le miroir prend la plus lointaine échéance
 * des documents de ce type (alias compris), le document corrigé inclus. Corriger un
 * document plus ancien que le plus récent ne fait donc pas reculer le miroir.
 * Renvoie `true` si une écriture a eu lieu.
 */
export async function syncVehicleDocumentMirrorFromDocuments(
  vehicleId: number,
  documentType: string | null | undefined,
): Promise<boolean> {
  const type = normalizeVehicleDocumentType(documentType);
  if (!(type in MIRROR_COLUMNS)) return false;
  const rows = await db
    .select({ type: vehicleDocuments.type, expiryDate: vehicleDocuments.expiryDate })
    .from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.vehicleId, vehicleId), isNotNull(vehicleDocuments.expiryDate)));
  const dates = rows
    .filter((row) => normalizeVehicleDocumentType(row.type) === type && row.expiryDate)
    .map((row) => toExpiryDateOnly(row.expiryDate))
    .filter((d): d is string => d !== null);
  if (dates.length === 0) return false;
  const latest = dates.reduce((a, b) => (a >= b ? a : b));
  return syncVehicleDocumentMirror(vehicleId, type, latest, "set");
}
