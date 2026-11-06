import { and, eq, inArray } from "drizzle-orm";
import { vehicleDocumentTypes } from "@shared/schema";
import { normalizeVehicleDocumentType } from "@shared/constants/vehicle-document-types";
import { db, type DbExecutor } from "../db";
import { AppError } from "./app-error";

export const UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE = "Type de document inconnu ou inactif.";

/**
 * Normalise chaque type reçu (alias historiques) puis exige un code actif du référentiel
 * `vehicle_document_types`. Renvoie les codes normalisés, dans l'ordre reçu ; 400 lisible
 * sinon, avant toute écriture (la clé étrangère n'est que le dernier filet).
 */
export async function resolveActiveVehicleDocumentTypes(rawTypes: readonly unknown[], executor: DbExecutor = db): Promise<string[]> {
  const codes = rawTypes.map((raw) => normalizeVehicleDocumentType(typeof raw === "string" ? raw : ""));
  if (codes.some((code) => !code)) throw new AppError(400, UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE);
  const wanted = [...new Set(codes)];
  if (wanted.length === 0) return codes;
  const rows = await executor
    .select({ code: vehicleDocumentTypes.code })
    .from(vehicleDocumentTypes)
    .where(and(inArray(vehicleDocumentTypes.code, wanted), eq(vehicleDocumentTypes.active, true)));
  const active = new Set(rows.map((r) => r.code));
  if (wanted.some((code) => !active.has(code))) throw new AppError(400, UNKNOWN_VEHICLE_DOCUMENT_TYPE_MESSAGE);
  return codes;
}

export async function resolveActiveVehicleDocumentType(rawType: unknown, executor: DbExecutor = db): Promise<string> {
  const [code] = await resolveActiveVehicleDocumentTypes([rawType], executor);
  return code;
}
