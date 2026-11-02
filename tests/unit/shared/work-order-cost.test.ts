import { describe, expect, it } from "vitest";
import { computeWorkOrderCost } from "../../../shared/work-order-cost";

/**
 * WO5 niveau U : le coût d'un OT = coût de base + pièces + rotations de pneus,
 * une seule formule pour l'écran de détail et le PDF.
 *
 * Avant : l'écran multipliait `unitPrice * quantity` sans contrôle (une pièce
 * sans prix donnait NaN et un total « NaN FCFA »), le PDF ramenait ces valeurs
 * à 0 : les deux totaux divergeaient.
 */
describe("computeWorkOrderCost", () => {
  it("additionne base, pièces et rotations, valeurs décimales en chaîne comprises", () => {
    expect(
      computeWorkOrderCost({
        baseCost: "10000.00",
        parts: [
          { unitPrice: "1500.50", quantity: 2 },
          { unitPrice: 5000, quantity: "1" },
        ],
        tireRotations: [{ cost: "2000.00" }, { cost: null }],
      }),
    ).toEqual({ baseCost: 10000, partsCost: 8001, tiresCost: 2000, totalCost: 20001 });
  });

  it("une pièce sans prix ou sans quantité compte 0, jamais NaN", () => {
    const cost = computeWorkOrderCost({
      baseCost: null,
      parts: [
        { unitPrice: undefined, quantity: 3 },
        { unitPrice: "abc", quantity: 1 },
        { unitPrice: "100", quantity: undefined },
        { unitPrice: "100", quantity: 2 },
      ],
      tireRotations: [{ cost: "" }, { cost: undefined }],
    });
    expect(cost).toEqual({ baseCost: 0, partsCost: 200, tiresCost: 0, totalCost: 200 });
    expect(Number.isNaN(cost.totalCost)).toBe(false);
  });

  it("listes absentes ou non tableaux : seul le coût de base compte", () => {
    expect(computeWorkOrderCost({ baseCost: 750, parts: undefined, tireRotations: null })).toEqual({
      baseCost: 750, partsCost: 0, tiresCost: 0, totalCost: 750,
    });
  });

  it("arrondit au centime pour éviter les écarts de virgule flottante", () => {
    expect(
      computeWorkOrderCost({ baseCost: "0.1", parts: [{ unitPrice: "0.2", quantity: 1 }], tireRotations: [] })
        .totalCost,
    ).toBe(0.3);
  });
});
