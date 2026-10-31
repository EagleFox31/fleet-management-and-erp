import { describe, expect, it } from "vitest";
import { AUDIT_CONFIG } from "../../../server/lib/audit-config";
import { matchAuditRule } from "../../../server/middleware/audit-writes";

describe("AUDIT_CONFIG (liste gelee)", () => {
  it("couvre exactement 8 types d'entite", () => {
    const types = [...new Set(AUDIT_CONFIG.rules.map((r) => r.entityType))].sort();
    expect(types).toEqual(["part", "part_requirement", "purchase_order", "supplier_invoice", "tire", "user", "vehicle", "work_order"]);
  });
  it("chemins imbriques rattaches a l'entite parente", () => {
    expect(matchAuditRule(AUDIT_CONFIG, "POST", "/work-orders/62/parts")).toEqual({ action: "create", entityType: "work_order", entityId: "62" });
    expect(matchAuditRule(AUDIT_CONFIG, "PATCH", "/supplier-invoices/39/approve")?.entityType).toBe("supplier_invoice");
    expect(matchAuditRule(AUDIT_CONFIG, "POST", "/work-orders")?.entityId).toBeNull();
  });
  it("hors liste : non audite", () => {
    expect(matchAuditRule(AUDIT_CONFIG, "POST", "/missions")).toBeNull();
    expect(matchAuditRule(AUDIT_CONFIG, "PATCH", "/vehicles/abc")).toBeNull();
  });
});
