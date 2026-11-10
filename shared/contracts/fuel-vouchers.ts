/**
 * Bons de carburant (P-17). Drapeau `fuel-vouchers`.
 *
 * L'identifiant est celui de `fuel_records`. Seul un bon en attente se valide :
 * déjà validé, ou modifié depuis la `version` affichée, il répond 409
 * (`FUEL_VOUCHER_STALE_MESSAGE`) sans rien réécrire. Un bon annulé (suppression douce) ou inconnu
 * répond 404, pas 409. Le technicien reçoit 403.
 */
import { z } from "zod";
import { idSchema, isoDateSchema, isoDateTimeSchema } from "./common";

export const validateFuelVoucherPath = (id: number) => `/api/fuel-vouchers/${id}/validate`;
export const fuelVoucherParamsSchema = z.object({ id: idSchema });

/** Réponse 409 d'une validation : bon déjà validé ou modifié depuis son affichage (un bon annulé répond 404). */
export const FUEL_VOUCHER_STALE_MESSAGE = "Ce plein a changé ou est déjà validé : rechargez la liste.";

/**
 * Corps de la validation. `version` (jeton opaque de la liste) : si présente, la validation exige
 * que le bon n'ait pas changé depuis son affichage. Absente (ancien client) : seul l'état compte.
 */
export const fuelVoucherValidateBodySchema = z.object({
  version: z.string().min(1).max(40).optional(),
});
export type FuelVoucherValidateBody = z.infer<typeof fuelVoucherValidateBodySchema>;

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
  /**
   * Jeton de version (dernière modification) à renvoyer à la validation. Optionnel en réponse : champ
   * ajouté à un contrat existant ; absent, la validation ne contrôle que l'état du bon.
   */
  version: z.string().optional(),
});

export const fuelVouchersResponseSchema = z.array(fuelVoucherSchema);

export type FuelVoucher = z.infer<typeof fuelVoucherSchema>;
export type FuelVouchersQuery = z.infer<typeof fuelVouchersQuerySchema>;
