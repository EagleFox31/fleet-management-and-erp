import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/storage", () => ({ storage: { getUser: async () => undefined } }));

import { AUDIT_MASK } from "../../../shared/contracts/audit-logs";
import { maskSecrets } from "../../../server/lib/audit";
import { AUDIT_CONFIG, CDC_AUDIT_CONFIG } from "../../../server/lib/audit-config";
import { isSessionGuard } from "../../../server/middleware/auth";
import { matchAuditRule } from "../../../server/middleware/audit-writes";
import { isIdempotentRoute } from "../../../server/middleware/idempotency-guard";
import telemetryRoutes from "../../../server/api/telemetry.routes";

type Layer = { handle: unknown; route?: unknown };

describe("/telemetry : aucune route sans garde de session", () => {
  it("le routeur commence par une garde de session marquée (le lot #6 la remplace par une garde jeton marquée)", () => {
    const stack = (telemetryRoutes as unknown as { stack: Layer[] }).stack;
    expect(stack.length).toBeGreaterThan(1);
    expect(isSessionGuard(stack[0].handle)).toBe(true);
    // Aucune route ne précède la garde.
    expect(stack.findIndex((layer) => layer.route)).toBeGreaterThan(0);
  });
});

describe("journal d'audit : chemin normalisé comme Express", () => {
  it("insensible à la casse", () => {
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "POST", "/PART-SALES")).not.toBeNull();
    expect(matchAuditRule(AUDIT_CONFIG, "PATCH", "/Work-Orders/5")?.entityType).toBe("work_order");
  });
  it("chemin décodé", () => {
    expect(matchAuditRule(AUDIT_CONFIG, "PATCH", "/work-orders/%35")).toEqual({ action: "update", entityType: "work_order", entityId: "5" });
  });
  it("encodage invalide : pas d'exception", () => {
    expect(() => matchAuditRule(AUDIT_CONFIG, "PATCH", "/work-orders/%E0%A4%A")).not.toThrow();
  });
  it("hors liste : toujours non audité", () => {
    expect(matchAuditRule(CDC_AUDIT_CONFIG, "POST", "/TELEMETRY/positions")).toBeNull();
  });
});

describe("garde d'idempotence : même normalisation", () => {
  const routes = [{ method: "POST", pattern: /^\/work-orders\/\d+\/time-entries$/ }] as const;
  it("casse et pourcentage", () => {
    expect(isIdempotentRoute(routes, "POST", "/Work-Orders/%35/TIME-ENTRIES")).toBe(true);
  });
});

describe("maskSecrets : clés sensibles par sous-chaîne", () => {
  it("masque jetons et clés d'API composés", () => {
    const out = maskSecrets({
      deviceToken: "a", apiKey: "b", accessToken: "c", "x-api-key": "d", api_key: "e",
      password: "f", pin: "g", token: "h", authorization: "i", cookie: "j", clientSecret: "k",
      plate: "AB-123",
    }) as Record<string, unknown>;
    for (const key of ["deviceToken", "apiKey", "accessToken", "x-api-key", "api_key", "password", "pin", "token", "authorization", "cookie", "clientSecret"]) {
      expect(out[key], key).toBe(AUDIT_MASK);
    }
    expect(out.plate).toBe("AB-123");
  });
  it("masque pin en mot entier (pin, newPin, pinCode, pin_code)", () => {
    const out = maskSecrets({ pin: "1", newPin: "2", pinCode: "3", pin_code: "4", PIN: "5", "x-pin": "6" }) as Record<string, unknown>;
    for (const key of Object.keys(out)) expect(out[key], key).toBe(AUDIT_MASK);
  });
  it("ne masque pas les clés qui contiennent seulement les lettres pin", () => {
    const out = maskSecrets({ shipping: "a", shippingAddress: "b", pinned: "c", spinner: "d", mapping: "e", pinpoint: "f" }) as Record<string, unknown>;
    for (const key of Object.keys(out)) expect(out[key], key).not.toBe(AUDIT_MASK);
  });
  it("masque en profondeur", () => {
    const out = maskSecrets({ device: { deviceToken: "a", name: "boîtier" } }) as { device: Record<string, unknown> };
    expect(out.device.deviceToken).toBe(AUDIT_MASK);
    expect(out.device.name).toBe("boîtier");
  });
});
