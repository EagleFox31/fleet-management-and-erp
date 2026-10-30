/**
 * Anomalies carburant (P-18). Drapeau `fuel-anomalies`.
 *
 * Les anomalies sont calculées, sans table ; leur clé stable est
 * `<règle>:<fuel_record_id>` (ex. `consumption-gap:412`). Un nouveau statut
 * remplace le précédent.
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common";

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

