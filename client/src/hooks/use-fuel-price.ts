import { useCallback } from "react";
import { useContractQuery } from "@/lib/contract-query";
import { FUEL_PRICES_PATH, fuelPriceAt, fuelPricesResponseSchema } from "@shared/contracts/fuel-prices";

/**
 * Prix du litre daté (P-19), pour les écrans où le prix est imposé à qui ne peut pas le
 * modifier (hors `FUEL_PRICE_WRITE_ROLES`). Sans liste (drapeau coupé, erreur) : 828 FCFA,
 * le prix par défaut du contrat.
 */
export function useFuelPrice() {
  const prices = useContractQuery(FUEL_PRICES_PATH, fuelPricesResponseSchema, undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const priceAt = useCallback((date: string) => fuelPriceAt(prices.data ?? [], date.slice(0, 10)), [prices.data]);
  return { priceAt, isLoading: prices.isLoading };
}
