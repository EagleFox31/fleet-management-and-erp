/**
 * Référentiel des types de document véhicule (P-05).
 *
 * `vehicle_documents.type` référence `vehicle_document_types(code)` (clé
 * étrangère posée NOT VALID : l'historique hors référentiel reste lisible).
 * Les écrivains normalisent le type (`normalizeVehicleDocumentType`) puis le
 * vérifient contre ce référentiel. Un type ne se supprime pas, il se désactive
 * (`active = false`) ; son code est immuable.
 * `validityMonths = null` : pas de durée fixe, l'alerte suit la date
 * d'expiration saisie.
 */
import { z } from "zod";
import { VEHICLE_DOCUMENT_TYPE_SEED as SEED } from "../constants/vehicle-document-types";

export const VEHICLE_DOCUMENT_TYPES_PATH = "/api/vehicle-document-types";
export const vehicleDocumentTypePath = (code: string) => `${VEHICLE_DOCUMENT_TYPES_PATH}/${encodeURIComponent(code)}`;

export const DEFAULT_DOCUMENT_ALERT_DAYS = 30;

export const vehicleDocumentTypeCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Code en minuscules, chiffres et tirets bas.");

export const vehicleDocumentTypeSchema = z.object({
  code: vehicleDocumentTypeCodeSchema,
  label: z.string().trim().min(2).max(120),
  validityMonths: z.number().int().min(1).max(240).nullable(),
  alertDays: z.number().int().min(0).max(365),
  active: z.boolean(),
  sortOrder: z.number().int().min(0),
});

export const createVehicleDocumentTypeRequestSchema = vehicleDocumentTypeSchema.extend({
  alertDays: vehicleDocumentTypeSchema.shape.alertDays.default(DEFAULT_DOCUMENT_ALERT_DAYS),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(100),
});

export const updateVehicleDocumentTypeRequestSchema = vehicleDocumentTypeSchema
  .omit({ code: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Aucune modification fournie." });

export const vehicleDocumentTypeListResponseSchema = z.array(vehicleDocumentTypeSchema);

export type VehicleDocumentType = z.infer<typeof vehicleDocumentTypeSchema>;
export type CreateVehicleDocumentTypeRequest = z.input<typeof createVehicleDocumentTypeRequestSchema>;
export type UpdateVehicleDocumentTypeRequest = z.infer<typeof updateVehicleDocumentTypeRequestSchema>;

/** Graine semée au démarrage : source unique dans shared/constants/vehicle-document-types.ts. */
export const VEHICLE_DOCUMENT_TYPE_SEED: readonly VehicleDocumentType[] = SEED;
