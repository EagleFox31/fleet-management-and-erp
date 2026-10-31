/**
 * Bons de carburant (P-17). Drapeau `fuel-vouchers`.
 *
 * L'identifiant est celui de `fuel_records` ; valider un bon déjà validé ne
 * réécrit rien. Le technicien reçoit 403.
 */
import { z } from "zod";
import { idSchema, isoDateSchema, isoDateTimeSchema } from "./common";

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


/** Liste des bons (lecture : FUEL_READ_ROLES). Filtre par statut ; `all` pour tout voir. */
export const FUEL_VOUCHERS_PATH = "/api/fuel-vouchers";
export const fuelVouchersQuerySchema = z.object({
  status: z.enum([...FUEL_VALIDATION_STATUSES, "all"]).default("pending"),
});

export const fuelVoucherSchema = z.object({
  id: z.number().int(),
  date: isoDateSchema.nullable(),
  vehicleId: z.number().int(),
  vehicleLabel: z.string().nullable(),
  quantity: z.number(),
  cost: z.number().nullable(),
  stationName: z.string().nullable(),
  validationStatus: z.enum(FUEL_VALIDATION_STATUSES),
  validatedByName: z.string().nullable(),
  validatedAt: isoDateTimeSchema.nullable(),
});

export const fuelVouchersResponseSchema = z.array(fuelVoucherSchema);

export type FuelVoucher = z.infer<typeof fuelVoucherSchema>;
export type FuelVouchersQuery = z.infer<typeof fuelVouchersQuerySchema>;
