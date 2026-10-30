/**
 * Référentiel des types de document véhicule (P-05).
 *
 * `vehicle_documents.type` reste du texte libre : le service valide contre ce
 * référentiel, sans contrainte SQL, pour ne pas casser l'historique. Un type
 * ne se supprime pas, il se désactive (`active = false`).
 * `validityMonths = null` : pas de durée fixe, l'alerte suit la date
 * d'expiration saisie.
 */
import { z } from "zod";

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

/** Les 9 types inscrits au démarrage (`ON CONFLICT DO NOTHING`). */
export const VEHICLE_DOCUMENT_TYPE_SEED: readonly VehicleDocumentType[] = [
  { code: "carte_grise", label: "Carte grise", validityMonths: 120 },
  { code: "carte_bleue", label: "Carte bleue", validityMonths: 12 },
  { code: "visite_technique", label: "Visite technique", validityMonths: 6 },
  { code: "acf", label: "ACF", validityMonths: null },
  { code: "tae", label: "TAE", validityMonths: 6 },
  { code: "vignette", label: "Vignette", validityMonths: 12 },
  { code: "jaugeage", label: "Jaugeage", validityMonths: 24 },
  { code: "assurance", label: "Assurance", validityMonths: 12 },
  { code: "agrement_pd", label: "Agrément PD", validityMonths: null },
].map((type, index) => ({ ...type, alertDays: DEFAULT_DOCUMENT_ALERT_DAYS, active: true, sortOrder: (index + 1) * 10 }));
