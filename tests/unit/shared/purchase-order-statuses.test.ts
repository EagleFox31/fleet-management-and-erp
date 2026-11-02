import { describe, expect, it } from "vitest";
import { purchaseOrders } from "../../../shared/schema";
import {
  canTransitionPurchaseOrder,
  getPurchaseOrderStatusLabel,
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
} from "../../../shared/constants/purchase-order-statuses";

describe("Statuts de commande fournisseur", () => {
  it("la liste suit l'enum de la colonne purchase_orders.status", () => {
    expect([...PURCHASE_ORDER_STATUSES].sort()).toEqual([...purchaseOrders.status.enumValues].sort());
  });

  it("chaque statut a un libellé d'écran et une entrée de transitions", () => {
    for (const status of PURCHASE_ORDER_STATUSES) {
      expect(PURCHASE_ORDER_STATUS_LABELS[status]).toBeTruthy();
      expect(PURCHASE_ORDER_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("garder le même statut est permis ; clôturée et annulée sont terminales", () => {
    expect(canTransitionPurchaseOrder("cancelled", "cancelled")).toBe(true);
    for (const to of PURCHASE_ORDER_STATUSES) {
      if (to !== "completed") expect(canTransitionPurchaseOrder("completed", to)).toBe(false);
      if (to !== "cancelled") expect(canTransitionPurchaseOrder("cancelled", to)).toBe(false);
    }
  });

  it("chaîne nominale permise, saut d'étape refusé", () => {
    expect(canTransitionPurchaseOrder("draft", "sent")).toBe(true);
    expect(canTransitionPurchaseOrder("sent", "confirmed")).toBe(true);
    expect(canTransitionPurchaseOrder("confirmed", "delivered")).toBe(true);
    expect(canTransitionPurchaseOrder("delivered", "completed")).toBe(true);
    expect(canTransitionPurchaseOrder("draft", "delivered")).toBe(false);
    expect(canTransitionPurchaseOrder("inconnu", "sent")).toBe(false);
  });

  it("libellé : statut inconnu rendu tel quel", () => {
    expect(getPurchaseOrderStatusLabel("cancelled")).toBe("Annulée");
    expect(getPurchaseOrderStatusLabel("xyz")).toBe("xyz");
  });
});
