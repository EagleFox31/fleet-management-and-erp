/**
 * Anomalies carburant (P-18). Drapeau `fuel-anomalies`.
 *
 * Les anomalies sont calculées, sans table ; leur clé stable est
 * `<règle>:<fuel_record_id>` (ex. `consumption-gap:412`). Un nouveau statut
 * remplace le précédent.
 */
import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common";

export const fuelAnomalyPath = (anomalyKey: string) => `/api/fuel-card/anomalies/${encodeURIComponent(anomalyKey)}`;

export const fuelAnomalyKeySchema = z.string().regex(/^[a-z][a-z0-9-]*:\d+$/, "Clé d'anomalie invalide.");
export const fuelAnomalyParamsSchema = z.object({ id: fuelAnomalyKeySchema });

export const FUEL_ANOMALY_STATUSES = ["open", "justified", "confirmed"] as const;
export type FuelAnomalyStatus = (typeof FUEL_ANOMALY_STATUSES)[number];

export const updateFuelAnomalyRequestSchema = z.object({
  status: z.enum(FUEL_ANOMALY_STATUSES),
  comment: z.string().trim().max(1000).optional(),
});

export const fuelAnomalyResolutionSchema = z.object({
  anomalyKey: fuelAnomalyKeySchema,
  fuelRecordId: z.number().int(),
  status: z.enum(FUEL_ANOMALY_STATUSES),
  comment: z.string().nullable(),
  resolvedBy: z.number().int().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
});

export type UpdateFuelAnomalyRequest = z.infer<typeof updateFuelAnomalyRequestSchema>;
export type FuelAnomalyResolution = z.infer<typeof fuelAnomalyResolutionSchema>;


/**
 * Liste des anomalies (lecture : FUEL_READ_ROLES). Règle `consumption-gap` : un plein
 * dont la quantité dépasse la moyenne du véhicule de plus de deux écarts-types
 * (au moins trois pleins débités), comme `fuelCardService.detectAnomalies`.
 * Le statut est celui de la dernière décision, `open` sans décision.
 */
export const FUEL_ANOMALIES_PATH = "/api/fuel-card/anomalies";
export const FUEL_ANOMALY_RULES = ["consumption-gap"] as const;

export const fuelAnomalySchema = z.object({
  anomalyKey: fuelAnomalyKeySchema,
  rule: z.enum(FUEL_ANOMALY_RULES),
  fuelRecordId: z.number().int(),
  date: isoDateSchema.nullable(),
  vehicleId: z.number().int(),
  vehicleLabel: z.string().nullable(),
  quantity: z.number(),
  averageQuantity: z.number(),
  threshold: z.number(),
  status: z.enum(FUEL_ANOMALY_STATUSES),
  comment: z.string().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
});

export const fuelAnomaliesResponseSchema = z.array(fuelAnomalySchema);

export type FuelAnomaly = z.infer<typeof fuelAnomalySchema>;
