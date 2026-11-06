import { describe, expect, it } from "vitest";
import { deliveryReceipts, type DeliveryLine } from "../../../server/lib/purchase-order-delivery";

/**
 * Réception globale d'une commande : l'alignement des lignes et l'entrée en stock portent sur les
 * mêmes lignes et les mêmes quantités.
 */

const line = (over: Partial<DeliveryLine>): DeliveryLine => ({
  lineId: 1,
  partId: 10,
  quantityOrdered: 2,
  quantityReceived: 0,
  deliveryStatus: "pending",
  ...over,
});

describe("deliveryReceipts", () => {
  it("ligne en attente : alignée sur le commandé, stock crédité de l'écart", () => {
    expect(deliveryReceipts([line({})])).toEqual([{ lineId: 1, partId: 10, receivedAfter: 2, stockIn: 2 }]);
  });

  it("ligne partielle : seul le reste est crédité", () => {
    expect(deliveryReceipts([line({ deliveryStatus: "partial", quantityReceived: 1 })])).toEqual([
      { lineId: 1, partId: 10, receivedAfter: 2, stockIn: 1 },
    ]);
  });

  it("statut absent : traité comme en attente", () => {
    expect(deliveryReceipts([line({ deliveryStatus: null, quantityReceived: null })])).toEqual([
      { lineId: 1, partId: 10, receivedAfter: 2, stockIn: 2 },
    ]);
  });

  it.each(["delivered", "accepted", "rejected"])("ligne close (%s) avec reçu < commandé : ni alignée ni créditée", (status) => {
    expect(deliveryReceipts([line({ deliveryStatus: status, quantityReceived: 1 })])).toEqual([]);
  });

  it("reçu supérieur au commandé : pas réduit, rien à créditer", () => {
    expect(deliveryReceipts([line({ quantityReceived: 3 })])).toEqual([{ lineId: 1, partId: 10, receivedAfter: 3, stockIn: 0 }]);
  });

  it("ligne sans pièce : alignée, aucun crédit", () => {
    expect(deliveryReceipts([line({ partId: null })])).toEqual([{ lineId: 1, partId: null, receivedAfter: 2, stockIn: 0 }]);
  });

  it("invariant : toute hausse du reçu sur une ligne avec pièce est créditée, et rien d'autre", () => {
    const lines = [
      line({ lineId: 1 }),
      line({ lineId: 2, deliveryStatus: "partial", quantityReceived: 1 }),
      line({ lineId: 3, deliveryStatus: "delivered", quantityReceived: 1 }),
      line({ lineId: 4, quantityReceived: 5 }),
    ];
    for (const receipt of deliveryReceipts(lines)) {
      const before = lines.find((l) => l.lineId === receipt.lineId)!.quantityReceived ?? 0;
      expect(receipt.stockIn).toBe(receipt.receivedAfter - before);
    }
  });
});
