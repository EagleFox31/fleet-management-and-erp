import { describe, expect, expectTypeOf, it } from "vitest";
import type { TireStatisticsAdvancedJson as TireStatisticsAdvanced } from "../../../shared/contracts/tire-statistics-advanced";
import { UNAVAILABLE } from "../../../client/src/components/dashboard/kpi-tiles";
import {
  actionCount,
  parseStatNumber,
  statText,
  stockAlertCount,
  toTireStatisticsView,
} from "../../../client/src/lib/tire-statistics-view";

/**
 * `GET /api/tires/statistics-advanced` sert `totalTires` et `totalValue` en texte (SUM Postgres)
 * ou `0`. La page les convertit une seule fois ; une valeur illisible devient « Indisponible »,
 * jamais 0 ni « NaN XAF ».
 */
const tire = (id: number, stockQuantity: number) => ({ id, stockQuantity }) as never;
const low = (id: number) => ({ type: "low_stock", message: "m", priority: "high", tire: tire(id, 1) }) as const;
const out = (id: number) => ({ type: "out_of_stock", message: "m", priority: "critical", tire: tire(id, 0) }) as const;

function payload(overrides: Partial<TireStatisticsAdvanced> = {}): TireStatisticsAdvanced {
  return {
    totalTires: "12",
    totalValue: "345000.50",
    averageWear: 6.2,
    lowStockCount: 1,
    requiredActions: { lowStock: [low(1)], outOfStock: [out(2)], criticalWear: [], rotationDue: [], rotationApproaching: [] },
    ...overrides,
  } as TireStatisticsAdvanced;
}

describe("parseStatNumber", () => {
  it("texte numérique du pilote : converti", () => {
    expect(parseStatNumber("12")).toBe(12);
    expect(parseStatNumber("345000.50")).toBe(345000.5);
    expect(parseStatNumber(" 7 ")).toBe(7);
  });

  it("nombre fini : gardé, zéro compris (stock réellement vide)", () => {
    expect(parseStatNumber(0)).toBe(0);
    expect(parseStatNumber(3.5)).toBe(3.5);
  });

  it("illisible ou absent : null, jamais 0", () => {
    for (const value of ["", "  ", "abc", "12abc", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      expect(parseStatNumber(value)).toBeNull();
    }
  });
});

describe("toTireStatisticsView", () => {
  it("convertit une seule fois les sommes servies en texte", () => {
    const view = toTireStatisticsView(payload());
    expect(view.totalTires).toBe(12);
    expect(view.totalValue).toBe(345000.5);
    expect(view.averageWear).toBe(6.2);
  });

  it("valeur illisible : null, pas 0", () => {
    const view = toTireStatisticsView(payload({ totalTires: "n/a", totalValue: "" }));
    expect(view.totalTires).toBeNull();
    expect(view.totalValue).toBeNull();
  });

  it("liste d'actions absente : null, pas une liste vide", () => {
    const raw = payload();
    delete (raw.requiredActions as Partial<typeof raw.requiredActions>).outOfStock;
    expect(toTireStatisticsView(raw).requiredActions.outOfStock).toBeNull();
    expect(toTireStatisticsView({ ...raw, requiredActions: undefined } as never).requiredActions.lowStock).toBeNull();
  });
});

describe("stockAlertCount : les ruptures comptent dans le stock critique", () => {
  it("rupture présente dans une seule liste : comptée", () => {
    expect(stockAlertCount(toTireStatisticsView(payload()).requiredActions)).toBe(2);
  });

  it("même pneu dans les deux listes : compté une fois", () => {
    const view = toTireStatisticsView(payload({
      requiredActions: { lowStock: [low(1), low(3)], outOfStock: [out(3)], criticalWear: [], rotationDue: [], rotationApproaching: [] },
    }));
    expect(stockAlertCount(view.requiredActions)).toBe(2);
  });

  it("une des deux listes manque : null, jamais une somme partielle", () => {
    const raw = payload();
    delete (raw.requiredActions as Partial<typeof raw.requiredActions>).outOfStock;
    expect(stockAlertCount(toTireStatisticsView(raw).requiredActions)).toBeNull();
  });
});

describe("actionCount", () => {
  const actions = toTireStatisticsView(payload({
    requiredActions: {
      lowStock: [low(1)],
      outOfStock: [out(2)],
      criticalWear: [{ type: "critical_wear", message: "m", priority: "critical", inspection: {} as never }],
      rotationDue: [],
      rotationApproaching: [],
    },
  })).requiredActions;

  it("additionne le stock critique (ruptures comprises) et les listes demandées", () => {
    expect(actionCount(actions, ["criticalWear", "rotationDue"])).toBe(3);
  });

  it("une liste demandée manque : null", () => {
    expect(actionCount({ ...actions, criticalWear: null }, ["criticalWear"])).toBeNull();
  });
});

describe("type client de la réponse", () => {
  it("les dates de la fiche pneu arrivent en texte, pas en Date", () => {
    type ServedTire = TireStatisticsAdvanced["requiredActions"]["lowStock"][number]["tire"];
    expectTypeOf<ServedTire["createdAt"]>().toEqualTypeOf<string>();
    expectTypeOf<ServedTire["deletedAt"]>().toEqualTypeOf<string | null>();
  });
});

describe("statText", () => {
  it("valeur connue : affichée, zéro compris", () => {
    expect(statText(0)).toBe(0);
    expect(statText(12)).toBe(12);
    expect(statText(1.25, (n) => `${n.toFixed(1)}mm`)).toBe("1.3mm");
  });

  it("valeur inconnue : « Indisponible »", () => {
    expect(statText(null)).toBe(UNAVAILABLE);
    expect(statText(undefined)).toBe(UNAVAILABLE);
  });
});
