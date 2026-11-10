import { describe, expect, it } from "vitest";
import { isSuggestedDiscountKnown } from "@/lib/purchase-order-discount";
import { canManagePartsPurchaseOrders } from "@shared/constants/roles";

describe("nouvelle commande : préremplissage de la remise", () => {
  it("remise d'historique connue : préremplie même si les suggestions sont en erreur", () => {
    expect(isSuggestedDiscountKnown({ historyDiscount: 7, canReadGroupSuggestions: true, groupSuggestionsReady: false })).toBe(true);
  });

  it("logistique (hors périmètre pièces) : rien à attendre, préremplie", () => {
    expect(isSuggestedDiscountKnown({ historyDiscount: 0, canReadGroupSuggestions: false, groupSuggestionsReady: false })).toBe(true);
  });

  it("sans historique, suggestions en erreur : pas de préremplissage à 0", () => {
    expect(isSuggestedDiscountKnown({ historyDiscount: 0, canReadGroupSuggestions: true, groupSuggestionsReady: false })).toBe(false);
  });

  it("sans historique, suggestions lues : préremplie", () => {
    expect(isSuggestedDiscountKnown({ historyDiscount: 0, canReadGroupSuggestions: true, groupSuggestionsReady: true })).toBe(true);
  });
});

describe("périmètre pièces des commandes", () => {
  it.each([
    ["admin", true],
    ["warehouse", true],
    ["secretary", true],
    ["logistics", false],
    [undefined, false],
  ])("%s → %s", (role, expected) => {
    expect(canManagePartsPurchaseOrders(role)).toBe(expected);
  });
});
