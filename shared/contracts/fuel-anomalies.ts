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
 * Liste des anomalies (lecture : FUEL_READ_ROLES). Règles :
 * - `consumption-gap` : un plein dont la quantité dépasse la moyenne du véhicule de plus de deux
 *   écarts-types (au moins trois pleins débités), comme `fuelCardService.detectAnomalies` ;
 *   `averageQuantity` = moyenne, `threshold` = moyenne + 2 écarts-types.
 * - `tank-overflow` : quantité supérieure à la capacité du véhicule + tolérance ; `averageQuantity` =
 *   capacité, `threshold` = capacité + tolérance, `tankCapacityL` renseigné. Muette sans capacité.
 * - `odometer-regression` : kilométrage inférieur à celui du plein précédent (date puis id) ;
 *   `averageQuantity` et `threshold` = kilométrage précédent, `mileage` et `previousMileage` renseignés.
 * Le statut est celui de la dernière décision, `open` sans décision.
 */
export const FUEL_ANOMALIES_PATH = "/api/fuel-card/anomalies";
export const FUEL_ANOMALY_RULES = ["consumption-gap", "tank-overflow", "odometer-regression"] as const;
export type FuelAnomalyRule = (typeof FUEL_ANOMALY_RULES)[number];

/** Compteur de l'écran : véhicules sans capacité de réservoir, pour lesquels `tank-overflow` ne dit rien. */
export const FUEL_ANOMALIES_SUMMARY_PATH = "/api/fuel-card/anomalies/summary";
export const fuelAnomaliesSummarySchema = z.object({
  vehiclesWithoutTankCapacity: z.number().int().nonnegative(),
  /** Les véhicules à compléter, triés par immatriculation, tronqués (le compteur reste le total). */
  vehicles: z.array(z.object({ id: z.number().int(), label: z.string() })).default([]),
});
export type FuelAnomaliesSummary = z.infer<typeof fuelAnomaliesSummarySchema>;

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
  // Propres à `odometer-regression` (kilométrages) et `tank-overflow` (capacité), absents sinon.
  mileage: z.number().int().nullable().optional(),
  previousMileage: z.number().int().nullable().optional(),
  tankCapacityL: z.number().nullable().optional(),
  status: z.enum(FUEL_ANOMALY_STATUSES),
  comment: z.string().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
});

export const fuelAnomaliesResponseSchema = z.array(fuelAnomalySchema);

export type FuelAnomaly = z.infer<typeof fuelAnomalySchema>;
