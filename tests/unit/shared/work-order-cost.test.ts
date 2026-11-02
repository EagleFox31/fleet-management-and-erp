import { describe, expect, it } from "vitest";
import {
  computeWorkOrderCost,
  laborRateAt,
  totalLaborHours,
} from "../../../shared/work-order-cost";
import { workOrderCost as kpiWorkOrderCost } from "../../../server/lib/kpi-rules";

/**
 * Coût d'OT, une seule règle pour l'écran, le PDF et le KPI (décision utilisateur du
 * 2 novembre 2026) : heures réelles × taux daté s'il y a un taux et des heures, sinon
 * `work_orders.cost` ; plus pièces et rotations de pneus.
 */
describe("main-d'oeuvre valorisée au taux horaire", () => {
  const parts = [{ unitPrice: "1500", quantity: 2 }];
  const tireRotations = [{ cost: "2000" }];

  it("taux et heures présents : heures × taux remplace le coût saisi", () => {
    expect(
      computeWorkOrderCost({ baseCost: "9999", parts, tireRotations, laborHours: "2.5", laborRate: 8000 }),
    ).toEqual({ baseCost: 20000, partsCost: 3000, tiresCost: 2000, totalCost: 25000, laborValued: true });
  });

  it("taux présent mais aucune heure : le coût saisi reste la main-d'oeuvre", () => {
    expect(computeWorkOrderCost({ baseCost: "9999", parts, tireRotations, laborHours: 0, laborRate: 8000 })).toMatchObject({
      baseCost: 9999,
      laborValued: false,
    });
  });

  it("aucun taux : le coût saisi, même avec des heures", () => {
    expect(computeWorkOrderCost({ baseCost: "9999", parts, tireRotations, laborHours: 3, laborRate: null })).toMatchObject({
      baseCost: 9999,
      laborValued: false,
    });
  });

  it("écran = PDF = KPI : même total, au FCFA près", () => {
    const cases = [
      { cost: 9999, hours: 2.5, rate: 8000 as number | null },
      { cost: 9999, hours: 0, rate: 8000 },
      { cost: 12000, hours: 4, rate: null },
    ];
    for (const c of cases) {
      const screen = computeWorkOrderCost({
        baseCost: c.cost,
        parts,
        tireRotations,
        laborHours: c.hours,
        laborRate: c.rate,
      });
      const kpi = kpiWorkOrderCost({ cost: c.cost, hours: c.hours, rate: c.rate, parts: 3000, tires: 2000 });
      expect(Math.round(screen.totalCost)).toBe(kpi.total);
      expect(Math.round(screen.baseCost)).toBe(kpi.labor);
    }
  });

  it("taux en vigueur : la ligne la plus récente à la date, rien avant la première", () => {
    const rates = [
      { effectiveFrom: "2026-01-01", hourlyRateHt: 7000 },
      { effectiveFrom: "2026-06-01", hourlyRateHt: 8000 },
    ];
    expect(laborRateAt(rates, "2026-05-31")?.hourlyRateHt).toBe(7000);
    expect(laborRateAt(rates, "2026-06-01")?.hourlyRateHt).toBe(8000);
    expect(laborRateAt(rates, "2025-12-31")).toBeNull();
  });

  it("heures réelles : lignes annulées exclues, valeurs illisibles à 0", () => {
    expect(
      totalLaborHours([
        { actualHours: "1.5", status: "done" },
        { actualHours: 2, status: "cancelled" },
        { actualHours: null, status: "pending" },
        { actualHours: "1" },
      ]),
    ).toBe(2.5);
    expect(totalLaborHours(undefined)).toBe(0);
  });
});

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
    ).toEqual({ baseCost: 10000, partsCost: 8001, tiresCost: 2000, totalCost: 20001, laborValued: false });
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
    expect(cost).toEqual({ baseCost: 0, partsCost: 200, tiresCost: 0, totalCost: 200, laborValued: false });
    expect(Number.isNaN(cost.totalCost)).toBe(false);
  });

  it("listes absentes ou non tableaux : seul le coût de base compte", () => {
    expect(computeWorkOrderCost({ baseCost: 750, parts: undefined, tireRotations: null })).toEqual({
      baseCost: 750, partsCost: 0, tiresCost: 0, totalCost: 750, laborValued: false,
    });
  });

  it("arrondit au centime pour éviter les écarts de virgule flottante", () => {
    expect(
      computeWorkOrderCost({ baseCost: "0.1", parts: [{ unitPrice: "0.2", quantity: 1 }], tireRotations: [] })
        .totalCost,
    ).toBe(0.3);
  });
});
