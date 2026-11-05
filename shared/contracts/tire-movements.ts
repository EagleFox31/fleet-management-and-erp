/**
 * Mouvements de pneus (P-15) : lecture seule, reconstituée à partir des
 * montages (`vehicle_tires`), rotations (`tire_rotations`) et inspections,
 * sans nouvelle table. Drapeau `tire-movements`.
 */
import { z } from "zod";
import { dateRangeQuerySchema, idSchema, isoDateTimeSchema } from "./common";

export const TIRE_MOVEMENTS_PATH = "/api/tires/movements";

export const TIRE_MOVEMENT_KINDS = ["installed", "removed", "rotated", "inspected"] as const;
export type TireMovementKind = (typeof TIRE_MOVEMENT_KINDS)[number];

export const tireMovementsQuerySchema = dateRangeQuerySchema.and(
  z.object({
    tireId: idSchema.optional(),
    vehicleId: idSchema.optional(),
  }),
);

export const tireMovementSchema = z.object({
  kind: z.enum(TIRE_MOVEMENT_KINDS),
  at: isoDateTimeSchema,
  tireId: z.number().int(),
  tireLabel: z.string(),
  vehicleId: z.number().int().nullable(),
  vehicleLabel: z.string().nullable(),
  position: z.string().nullable(),
  mileage: z.number().int().min(0).nullable(),
  byUserName: z.string().nullable(),
});

export const tireMovementsResponseSchema = z.array(tireMovementSchema);

export type TireMovementsQuery = z.infer<typeof tireMovementsQuerySchema>;
export type TireMovement = z.infer<typeof tireMovementSchema>;
