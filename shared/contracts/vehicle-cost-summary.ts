/**
 * Coût d'un véhicule sur une période (P-14) : main-d'œuvre
 * (`work_orders.cost`), pièces (`parts_used`) et carburant. Montants en FCFA.
 * Drapeau `vehicle-cost-summary`.
 */
import { z } from "zod";
import { dateRangeQuerySchema, isoDateSchema, routeIdSchema } from "./common";

export const vehicleCostSummaryPath = (id: number) => `/api/vehicles/${id}/cost-summary`;
export const vehicleCostSummaryParamsSchema = z.object({ id: routeIdSchema });
export const vehicleCostSummaryQuerySchema = dateRangeQuerySchema;

const amount = z.number().min(0);

export const vehicleCostSummaryResponseSchema = z.object({
  vehicleId: z.number().int(),
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
  labor: amount,
  parts: amount,
  fuel: amount,
  total: amount,
  workOrderCount: z.number().int().min(0),
  fuelLiters: z.number().min(0),
});

export type VehicleCostSummaryResponse = z.infer<typeof vehicleCostSummaryResponseSchema>;
