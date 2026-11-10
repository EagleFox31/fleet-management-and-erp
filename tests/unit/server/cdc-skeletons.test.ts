import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_CONFIG, CDC_AUDIT_CONFIG } from "../../../server/lib/audit-config";
import { IDEMPOTENCY_ROUTES } from "../../../server/lib/idempotency-config";
import { idempotencyGuard, isIdempotentRoute } from "../../../server/middleware/idempotency-guard";
import { matchAuditRule } from "../../../server/middleware/audit-writes";
import { runIdempotencyPurge, type IdempotencyPurgeDeps } from "../../../server/jobs/idempotency-purge";

afterEach(() => {
  delete process.env.FEATURE_FLAGS;
});

describe("journal d'audit des ressources CDC", () => {
  it("audite les écritures des nouvelles ressources", () => {
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "POST", "/part-sales")).toEqual({ action: "create", entityType: "part_sale", entityId: null });
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "PATCH", "/admin/telemetry-devices/4")).toEqual({ action: "update", entityType: "telemetry_device", entityId: "4" });
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "POST", "/imports/interventions")?.entityType).toBe("import");
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "PUT", "/workshop-labor-rates/2")?.entityType).toBe("workshop_labor_rate");
  });

  it("n'audite ni les positions ni la télémétrie (volume)", () => {
    for (const path of ["/telemetry/positions", "/vehicle-positions", "/vehicle-positions/13"]) {
      expect(matchAuditRule(CDC_AUDIT_CONFIG, "POST", path), path).toBeNull();
      expect(matchAuditRule(AUDIT_CONFIG, "POST", path), path).toBeNull();
    }
  });

  it("ne recoupe pas la liste gelée des 8 entités", () => {
    const frozen = new Set(AUDIT_CONFIG.rules.map((rule) => rule.entityType));
    for (const rule of CDC_AUDIT_CONFIG.rules) expect(frozen.has(rule.entityType), rule.entityType).toBe(false);
  });
});

describe("garde d'idempotence (socle)", () => {
  it("lot #10b (statut de mission, kilométrage), stock et panne chauffeur, qui gardent leur clé", () => {
    expect(IDEMPOTENCY_ROUTES.map((r) => `${r.method} ${r.pattern.source}`)).toEqual([
      "PUT ^\\/missions\\/\\d+\\/status$",
      "PUT ^\\/vehicles\\/\\d+\\/mileage$",
      "POST ^\\/parts\\/\\d+\\/update-stock$",
      "POST ^\\/driver\\/breakdowns$",
    ]);
    for (const route of IDEMPOTENCY_ROUTES.slice(0, 2)) {
      expect(route.staleSeconds).toBeUndefined();
      expect(route.keepKeyOnUncertainOutcome).toBeUndefined();
      expect(route.ignoreFeatureFlag).toBeUndefined();
    }
    expect(IDEMPOTENCY_ROUTES[2]).toMatchObject({ staleSeconds: null, keepKeyOnUncertainOutcome: true, ignoreFeatureFlag: true });
    // Panne du chauffeur (V5b-1) : clé gardée, mais soumise au drapeau offline-writes.
    expect(IDEMPOTENCY_ROUTES[3]).toMatchObject({ staleSeconds: null, keepKeyOnUncertainOutcome: true });
    expect(IDEMPOTENCY_ROUTES[3].ignoreFeatureFlag).toBeUndefined();
  });

  it("transmet une route non listée, drapeau coupé ou allumé", () => {
    for (const flags of [undefined, "offline-writes=on"]) {
      if (flags) process.env.FEATURE_FLAGS = flags;
      const next = vi.fn();
      idempotencyGuard()({ method: "POST", originalUrl: "/api/work-orders/1/parts" } as never, {} as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    }
  });

  it("reconnaît une route listée par méthode et chemin", () => {
    const routes = [{ method: "POST", pattern: /^\/work-orders\/\d+\/time-entries$/ }] as const;
    expect(isIdempotentRoute(routes, "post", "/work-orders/5/time-entries?x=1")).toBe(true);
    expect(isIdempotentRoute(routes, "GET", "/work-orders/5/time-entries")).toBe(false);
  });
});

describe("purge des clés d'idempotence (squelette)", () => {
  function deps(overrides: Partial<IdempotencyPurgeDeps> = {}) {
    const calls: string[] = [];
    const base: IdempotencyPurgeDeps = {
      isEnabled: () => true,
      tryLock: async () => (calls.push("lock"), true),
      unlock: async () => void calls.push("unlock"),
      tableExists: async () => (calls.push("table"), true),
      purgeExpired: async () => (calls.push("purge"), 0),
    };
    return { calls, deps: { ...base, ...overrides } };
  }

  it("drapeau coupé : ne prend pas le verrou", async () => {
    const { calls, deps: d } = deps({ isEnabled: () => false });
    expect(await runIdempotencyPurge(d)).toBe("disabled");
    expect(calls).toEqual([]);
  });

  it("verrou pris ailleurs : ne purge pas", async () => {
    const { calls, deps: d } = deps({ tryLock: async () => false });
    expect(await runIdempotencyPurge(d)).toBe("locked");
    expect(calls).toEqual([]);
  });

  it("table absente : relâche le verrou sans purger", async () => {
    const { calls, deps: d } = deps({ tableExists: async () => false });
    expect(await runIdempotencyPurge(d)).toBe("no-table");
    expect(calls).toEqual(["lock", "unlock"]);
  });

  it("table présente : purge puis relâche, même si la purge échoue", async () => {
    const ok = deps();
    expect(await runIdempotencyPurge(ok.deps)).toBe("purged");
    expect(ok.calls).toEqual(["lock", "table", "purge", "unlock"]);

    const failing = deps({ purgeExpired: async () => { throw new Error("boom"); } });
    await expect(runIdempotencyPurge(failing.deps)).rejects.toThrow("boom");
    expect(failing.calls).toContain("unlock");
  });
});
