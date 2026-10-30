/**
 * Bons de carburant (P-17). Drapeau `fuel-vouchers`.
 *
 * L'identifiant est celui de `fuel_records` ; valider un bon déjà validé ne
 * réécrit rien. Le technicien reçoit 403.
 */
import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const validateFuelVoucherPath = (id: number) => `/api/fuel-vouchers/${id}/validate`;
export const fuelVoucherParamsSchema = z.object({ id: idSchema });

export const FUEL_VALIDATION_STATUSES = ["pending", "validated"] as const;
export type FuelValidationStatus = (typeof FUEL_VALIDATION_STATUSES)[number];

export const fuelVoucherValidationResponseSchema = z.object({
  id: z.number().int(),
  validationStatus: z.enum(FUEL_VALIDATION_STATUSES),
  validatedBy: z.number().int().nullable(),
  validatedAt: isoDateTimeSchema.nullable(),
});

export type FuelVoucherValidationResponse = z.infer<typeof fuelVoucherValidationResponseSchema>;

