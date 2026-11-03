import { describe, expect, it } from "vitest";
import { STAFF_ROLES, WORK_ORDER_COST_READ_ROLES, canReadWorkOrderCost } from "../../../shared/constants/roles";

/** Taux horaire d'un OT : personnel hors chauffeur (revue sécurité #89). */
describe("WORK_ORDER_COST_READ_ROLES", () => {
  it("exclut le chauffeur et le client, garde le reste du personnel", () => {
    expect(WORK_ORDER_COST_READ_ROLES).not.toContain("driver");
    expect(WORK_ORDER_COST_READ_ROLES).not.toContain("client");
    expect([...WORK_ORDER_COST_READ_ROLES].sort()).toEqual(STAFF_ROLES.filter((r) => r !== "driver").sort());
  });

  it("canReadWorkOrderCost suit la liste", () => {
    expect(canReadWorkOrderCost("technician")).toBe(true);
    expect(canReadWorkOrderCost("driver")).toBe(false);
    expect(canReadWorkOrderCost(null)).toBe(false);
  });
});
