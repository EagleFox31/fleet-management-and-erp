import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_MASK } from "../../../shared/contracts/audit-logs";
import { maskSecrets, prepareAuditBody, recordAudit, setAuditSink } from "../../../server/lib/audit";
import { matchAuditRule } from "../../../server/middleware/audit-writes";

afterEach(() => setAuditSink(null));

describe("maskSecrets", () => {
  it("masque les cles sensibles, imbriquees et en tableau", () => {
    const input = { name: "a", password: "x", nested: { pin: "1234", apiSecret: "s", ok: 1 }, list: [{ token: "t", v: 2 }], Authorization: "Bearer z" };
    const out = maskSecrets(input) as any;
    expect(out.name).toBe("a");
    expect(out.password).toBe(AUDIT_MASK);
    expect(out.nested).toEqual({ pin: AUDIT_MASK, apiSecret: AUDIT_MASK, ok: 1 });
    expect(out.list[0]).toEqual({ token: AUDIT_MASK, v: 2 });
    expect(out.Authorization).toBe(AUDIT_MASK);
    expect(input.password).toBe("x");
  });
  it("tolere primitives et null", () => {
    expect(maskSecrets(null)).toBeNull();
    expect(maskSecrets("x")).toBe("x");
  });
});

describe("prepareAuditBody", () => {
  it("tronque au-dela de 4 ko", () => {
    const r = prepareAuditBody({ big: "a".repeat(10000) })!;
    expect(r.truncated).toBe(true);
    expect(String(r.preview).length).toBe(4096);
  });
  it("aucun corps : null", () => expect(prepareAuditBody(undefined)).toBeNull());
});

describe("matchAuditRule", () => {
  const cfg = { rules: [{ pattern: /^\/work-orders\/(\d+)$/, entityType: "work_order" }, { pattern: /^\/work-orders$/, entityType: "work_order" }] };
  it("extrait entite et id", () => {
    expect(matchAuditRule(cfg, "PATCH", "/work-orders/62?x=1")).toEqual({ action: "update", entityType: "work_order", entityId: "62" });
    expect(matchAuditRule(cfg, "POST", "/work-orders")).toEqual({ action: "create", entityType: "work_order", entityId: null });
  });
  it("ignore GET et chemins hors regles", () => {
    expect(matchAuditRule(cfg, "GET", "/work-orders/62")).toBeNull();
    expect(matchAuditRule(cfg, "POST", "/vehicles")).toBeNull();
  });
});

describe("recordAudit", () => {
  it("une panne du sink ne se propage pas", async () => {
    setAuditSink(vi.fn().mockRejectedValue(new Error("db down")));
    await expect(recordAudit({ userId: 1, action: "create", entityType: "x", entityId: null, method: "POST", path: "/x", details: null })).resolves.toBeUndefined();
  });
  it("masque aussi les details passes directement", async () => {
    const sink = vi.fn().mockResolvedValue(undefined);
    setAuditSink(sink);
    await recordAudit({ userId: 1, action: "login", entityType: "auth", entityId: null, method: null, path: null, details: { password: "p" } });
    expect(sink.mock.calls[0][0].details).toEqual({ password: AUDIT_MASK });
  });
});
