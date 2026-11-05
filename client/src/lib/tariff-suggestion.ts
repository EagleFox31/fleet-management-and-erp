import type { PricingUnit } from "@shared/contracts/tariff-grid";

/** Ville d'une adresse libre : texte avant la première virgule (repli quand l'adresse entière ne correspond à aucun tarif). */
export function cityOf(address: string): string {
  return address.split(",")[0].trim();
}

export type SuggestionInput = {
  clientId: string;
  pickupAddress: string;
  deliveryAddress: string;
  cargoDescription: string;
  pickupDate: string;
};

export type SuggestionAttempt = { matchedOnCity: boolean; params: Record<string, string> };

/**
 * Tentatives d'appel dans l'ordre : adresses entières, puis villes seules si elles diffèrent.
 * Aucune tentative tant que départ ou arrivée est vide ; sans date, le serveur prend le jour de Douala.
 */
export function suggestionAttempts(input: SuggestionInput): SuggestionAttempt[] {
  const origin = input.pickupAddress.trim();
  const destination = input.deliveryAddress.trim();
  if (!origin || !destination) return [];
  const shared: Record<string, string> = {};
  if (input.clientId) shared.clientId = input.clientId;
  if (input.cargoDescription.trim()) shared.cargoType = input.cargoDescription.trim().slice(0, 120);
  if (input.pickupDate) shared.date = input.pickupDate;
  const attempts: SuggestionAttempt[] = [{ matchedOnCity: false, params: { ...shared, origin, destination } }];
  const originCity = cityOf(origin);
  const destinationCity = cityOf(destination);
  if (originCity && destinationCity && (originCity !== origin || destinationCity !== destination)) {
    attempts.push({ matchedOnCity: true, params: { ...shared, origin: originCity, destination: destinationCity } });
  }
  return attempts;
}

/** Montant proposé pour la mission : prix × poids à la tonne (poids connu), sinon le prix du tarif tel quel. */
export function suggestedMissionAmount(unitPrice: number, unit: PricingUnit, weightTonnes: number | null): number {
  if (unit === "ton" && weightTonnes !== null && Number.isFinite(weightTonnes) && weightTonnes > 0) {
    return Math.round(unitPrice * weightTonnes);
  }
  return unitPrice;
}

/** Saisie d'un prix en XAF entier positif ou nul ; vide = pas de prix. */
export function parseAgreedPrice(input: string): number | null | "invalid" {
  const t = input.trim();
  if (t === "") return null;
  if (!/^\d{1,15}$/.test(t)) return "invalid";
  return Number(t);
}
