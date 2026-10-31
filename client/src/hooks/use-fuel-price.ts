import { useCallback } from "react";
import { useContractQuery } from "@/lib/contract-query";
import { useFeature } from "@/hooks/use-feature";
import { isFuelPriceImposed } from "@/lib/fuel-price-policy";
import { FUEL_PRICES_PATH, fuelPriceAt, fuelPricesResponseSchema } from "@shared/contracts/fuel-prices";

/**
 * Prix du litre daté (P-19). Imposé seulement si le drapeau `fuel-prices` est actif et
 * que le rôle n'est pas dans `FUEL_PRICE_WRITE_ROLES`. Sinon (`imposed` faux) : saisie
 * libre comme avant, la liste n'est même pas demandée (elle répondrait 404).
 * `isLoading` : liste attendue ; l'envoi du formulaire doit rester désactivé.
 */
export function useFuelPrice(role: string | null | undefined) {
  const enabled = useFeature("fuel-prices");
  const imposed = isFuelPriceImposed(role, enabled);
  const prices = useContractQuery(FUEL_PRICES_PATH, fuelPricesResponseSchema, undefined, {
    enabled: imposed,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const priceAt = useCallback((date: string) => fuelPriceAt(prices.data ?? [], date.slice(0, 10)), [prices.data]);
  return {
    imposed,
    canEdit: !imposed,
    priceAt,
    isLoading: imposed && prices.isLoading,
  };
}
