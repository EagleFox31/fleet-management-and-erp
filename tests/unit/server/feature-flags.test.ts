import { describe, expect, it, vi } from "vitest";
import { FEATURE_KEYS } from "../../../shared/feature-flags";
import { getFeatureFlags, isFeatureEnabled, requireFeature } from "../../../server/lib/feature-flags";
import { AppError, errorHandler, errorResponseGuard, mergeErrorDetails } from "../../../server/middleware/error-handler";

describe("getFeatureFlags", () => {
  it("renvoie toutes les clés avec les défauts", () => {
    const flags = getFeatureFlags("");
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(flags.exports).toBe(true);
    expect(flags["fuel-vouchers"]).toBe(false);
  });
  it("applique les surcharges et ignore les entrées illisibles sans lever", () => {
    const flags = getFeatureFlags("fuel-vouchers=on,exports=off,inconnu=on,fuel-prices=peutetre");
    expect(flags["fuel-vouchers"]).toBe(true);
    expect(flags.exports).toBe(false);
    expect(flags["fuel-prices"]).toBe(false);
  });
});

describe("requireFeature", () => {
  it("laisse passer un drapeau allumé", () => {
    const next = vi.fn();
    process.env.FEATURE_FLAGS = "fuel-vouchers=on";
    requireFeature("fuel-vouchers")({} as never, {} as never, next);
    delete process.env.FEATURE_FLAGS;
    expect(next).toHaveBeenCalledWith();
  });
  it("transmet une AppError 404 quand le drapeau est coupé", () => {
    const next = vi.fn();
    expect(isFeatureEnabled("fuel-vouchers", "")).toBe(false);
    requireFeature("fuel-vouchers")({} as never, {} as never, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("AppError.details", () => {
  it("fusionne sans écraser les clés réservées", () => {
    const body = { message: "m", code: "RATE_LIMITED", requestId: "r" };
    const merged = mergeErrorDetails(body, { lockedUntil: "2026-11-02T10:00:00Z", message: "pirate", code: "X", requestId: "Y", errors: [] });
    expect(merged).toEqual({ ...body, lockedUntil: "2026-11-02T10:00:00Z" });
  });
  it("sans details, le corps est inchangé", () => {
    const body = { message: "m" };
    expect(mergeErrorDetails(body, undefined)).toBe(body);
  });
  it("errorHandler + garde de sortie produisent le corps fusionné", () => {
    const res: any = {
      statusCode: 200, headersSent: false, locals: {}, body: undefined,
      status(c: number) { this.statusCode = c; return this; },
      json(b: unknown) { this.body = b; return this; },
    };
    const req: any = { requestId: "req-1", method: "POST", path: "/api/auth/login" };
    errorResponseGuard(req, res, () => {});
    errorHandler(new AppError(429, "Compte verrouillé.", { details: { lockedUntil: "2026-11-02T10:00:00Z" } }), req, res, () => {});
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ message: "Compte verrouillé.", code: "RATE_LIMITED", requestId: "req-1", lockedUntil: "2026-11-02T10:00:00Z" });
  });
});
