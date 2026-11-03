import { canWriteFuelPrice } from "@shared/constants/roles";
import { getFuelPriceAt } from "../services/fuel-price-service";

/**
 * Prix du litre retenu pour un débit de carte carburant.
 *
 * Seuls les rôles qui fixent le prix (`canWriteFuelPrice` : admin, logistique, décision du
 * 31 octobre 2026) peuvent saisir un autre prix que celui du jour. Pour tous les autres, le
 * serveur impose le prix en vigueur à la date du plein : le prix envoyé par le client est
 * ignoré, comme l'écran le fait déjà (champ en lecture seule). Sans cela, un appel direct à
 * l'API débitait la carte au prix choisi par l'appelant.
 *
 * Les routes gardent le prix obligatoire (contrat inchangé) ; un prix non exploitable d'un rôle
 * autorisé retombe aussi sur le prix du jour.
 */
export async function resolveFuelUnitPrice(
  role: string | null | undefined,
  submitted: number | null | undefined,
  fillDate: Date,
): Promise<number> {
  if (canWriteFuelPrice(role) && typeof submitted === "number" && Number.isFinite(submitted) && submitted > 0) {
    return submitted;
  }
  return getFuelPriceAt(fillDate.toISOString().slice(0, 10));
}
