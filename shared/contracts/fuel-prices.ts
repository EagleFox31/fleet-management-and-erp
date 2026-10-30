/**
 * Prix du carburant daté (P-19). Drapeau `fuel-prices`.
 *
 * Un prix par date d'effet. Un plein garde le prix du jour où il a été saisi,
 * jamais recalculé.
 */
import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common";

export const FUEL_PRICES_PATH = "/api/fuel-prices";

/** Prix historique en FCFA par litre, inscrit avec la date d'effet 2000-01-01. */
export const DEFAULT_FUEL_PRICE_PER_LITER = 828;
export const DEFAULT_FUEL_PRICE_EFFECTIVE_FROM = "2000-01-01";

export const fuelPriceSchema = z.object({
  effectiveFrom: isoDateSchema,
  pricePerLiter: z.number().positive().max(100_000),
  createdBy: z.number().int().nullable(),
  createdAt: isoDateTimeSchema.nullable(),
});

/** Poser le prix d'une date : une seconde saisie à la même date le corrige. */
export const createFuelPriceRequestSchema = fuelPriceSchema.pick({ effectiveFrom: true, pricePerLiter: true });

export const fuelPricesResponseSchema = z.array(fuelPriceSchema);

export type FuelPrice = z.infer<typeof fuelPriceSchema>;
export type CreateFuelPriceRequest = z.infer<typeof createFuelPriceRequestSchema>;

/** Prix applicable à une date : le dernier dont la date d'effet la précède ou l'égale. */
export function fuelPriceAt(prices: readonly Pick<FuelPrice, "effectiveFrom" | "pricePerLiter">[], date: string): number {
  let best: Pick<FuelPrice, "effectiveFrom" | "pricePerLiter"> | undefined;
  for (const price of prices) {
    if (price.effectiveFrom <= date && (!best || price.effectiveFrom > best.effectiveFrom)) best = price;
  }
  return best?.pricePerLiter ?? DEFAULT_FUEL_PRICE_PER_LITER;
}
