import { eq } from "drizzle-orm";
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

/**
 * `vehicle_documents` fait foi ; les colonnes `vehicles.*` en sont le miroir lu par
 * l'éligibilité mission et par les alertes. À appeler après tout dépôt ou changement
 * de date d'un document. Sans date, ou pour un type sans miroir, ne fait rien.
 */
export async function syncVehicleDocumentMirror(
  vehicleId: number,
  documentType: string | null | undefined,
  expiryDate: string | Date | null | undefined,
): Promise<void> {
  if (!expiryDate) return;
  const value = expiryDate instanceof Date ? expiryDate.toISOString().slice(0, 10) : expiryDate;
  switch (normalizeVehicleDocumentType(documentType)) {
    case "carte_grise":
      await db.update(vehicles).set({ licensePlateExpiry: value }).where(eq(vehicles.id, vehicleId));
      break;
    case "assurance":
      await db.update(vehicles).set({ insuranceExpiry: value }).where(eq(vehicles.id, vehicleId));
      break;
    case "visite_technique":
      await db.update(vehicles).set({ technicalInspectionDate: value }).where(eq(vehicles.id, vehicleId));
      break;
    default:
      break;
  }
}
