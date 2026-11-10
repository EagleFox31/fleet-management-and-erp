import { describe, expect, it } from "vitest";
import { AUDIT_CONFIG } from "../../../server/lib/audit-config";
import { matchAuditRule, wantsResponseId } from "../../../server/middleware/audit-writes";

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

describe("matchAuditRule : prefixe /api et casse (contournement du journal)", () => {
  it("/API, /Api et %61pi sont journalises comme /api", () => {
    for (const p of ["/api/work-orders/62/parts", "/API/work-orders/62/parts", "/Api/Work-Orders/62/parts", "/%61pi/work-orders/62/parts", "/work-orders/62/parts"]) {
      expect(matchAuditRule(AUDIT_CONFIG, "POST", p), p).toEqual({ action: "create", entityType: "work_order", entityId: "62" });
    }
    expect(matchAuditRule(AUDIT_CONFIG, "PATCH", "/API/technician/work-orders/7/status")?.entityId).toBe("7");
    expect(matchAuditRule(AUDIT_CONFIG, "POST", "/apiary/work-orders/62")).toBeNull();
  });
});

describe("wantsResponseId (creation d'OT)", () => {
  it("seule la creation d'OT lit l'id dans la reponse, quelle que soit la casse du prefixe", () => {
    expect(wantsResponseId(AUDIT_CONFIG, "POST", "/api/work-orders")).toBe(true);
    expect(wantsResponseId(AUDIT_CONFIG, "POST", "/API/Work-Orders/")).toBe(true);
    expect(wantsResponseId(AUDIT_CONFIG, "POST", "/api/work-orders/62/parts")).toBe(false);
    expect(wantsResponseId(AUDIT_CONFIG, "PATCH", "/api/work-orders")).toBe(false);
    expect(wantsResponseId(AUDIT_CONFIG, "POST", "/api/parts")).toBe(false);
  });
});
