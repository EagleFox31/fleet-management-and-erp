/**
 * Préremplissage de la remise d'une nouvelle commande : la remise négociée tirée de l'historique
 * du fournisseur prime et ne dépend pas des suggestions de regroupement. Sans elle, la remise de
 * regroupement doit avoir été lue : une lecture en échec ne préremplit pas 0. Hors périmètre
 * pièces (logistique), il n'y a pas de remise de regroupement à attendre.
 */
export function isSuggestedDiscountKnown(input: {
  historyDiscount: number;
  canReadGroupSuggestions: boolean;
  groupSuggestionsReady: boolean;
}): boolean {
  return input.historyDiscount > 0 || !input.canReadGroupSuggestions || input.groupSuggestionsReady;
}
