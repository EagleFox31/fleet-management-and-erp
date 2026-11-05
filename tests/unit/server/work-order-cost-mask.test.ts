import { describe, expect, it } from "vitest";
import { maskWorkOrderCost, WORK_ORDER_COST_KEYS } from "../../../server/lib/work-order-cost-mask";

describe("maskWorkOrderCost", () => {
  it("la liste des clés retirées est fermée : cost, unitPrice, totalCost", () => {
    expect([...WORK_ORDER_COST_KEYS].sort()).toEqual(["cost", "totalCost", "unitPrice"]);
  });

  it("retire les clés de coût d'un objet et garde les autres", () => {
    expect(maskWorkOrderCost({ id: 1, title: "Vidange", cost: "1500.00", status: "pending" })).toEqual({
      id: 1,
      title: "Vidange",
      status: "pending",
    });
  });

  it("descend dans les objets imbriqués et les tableaux", () => {
    const body = {
      total: 2,
      workOrders: [
        { id: 1, cost: "10", parts: [{ id: 5, unitPrice: "4000", totalCost: 8000, quantity: 2 }] },
        { id: 2, vehicle: { id: 9, plate: "TEST", cost: "1" } },
      ],
    };
    expect(maskWorkOrderCost(body)).toEqual({
      total: 2,
      workOrders: [{ id: 1, parts: [{ id: 5, quantity: 2 }] }, { id: 2, vehicle: { id: 9, plate: "TEST" } }],
    });
  });

  it("ne modifie pas l'objet d'origine", () => {
    const body = { id: 1, cost: "10", nested: { unitPrice: "5" } };
    maskWorkOrderCost(body);
    expect(body).toEqual({ id: 1, cost: "10", nested: { unitPrice: "5" } });
  });

  it("garde null, undefined, les scalaires et les tableaux vides", () => {
    expect(maskWorkOrderCost(null)).toBeNull();
    expect(maskWorkOrderCost(undefined)).toBeUndefined();
    expect(maskWorkOrderCost("texte")).toBe("texte");
    expect(maskWorkOrderCost(0)).toBe(0);
    expect(maskWorkOrderCost([])).toEqual([]);
    expect(maskWorkOrderCost({ id: 1, technician: null, endDate: null })).toEqual({ id: 1, technician: null, endDate: null });
  });

  it("laisse une Date intacte (même instance), dans un objet comme dans un tableau", () => {
    const date = new Date("2026-11-05T10:00:00Z");
    const out = maskWorkOrderCost({ createdAt: date, cost: "1", list: [date] });
    expect(out.createdAt).toBe(date);
    expect(out.list[0]).toBe(date);
    expect("cost" in out).toBe(false);
  });

  it("ne confond pas une clé voisine avec une clé de coût", () => {
    const body = { costCenter: "A", estimatedCost: 3, unit_price: 1, Cost: 2 };
    expect(maskWorkOrderCost(body)).toEqual(body);
  });
});
