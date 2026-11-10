import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { createKeyedRateLimiter } from "../../../server/middleware/keyed-rate-limit";
import { AppError } from "../../../server/lib/app-error";

/** Limiteur par clé (seau à jetons) : rafale tolérée, recharge régulière, 429 avec code dédié. */
function harness(opts: { capacity: number; refillMs: number; maxEntries?: number }) {
  let t = 1_000_000;
  const limiter = createKeyedRateLimiter({
    keyOf: (req) => String((req as any).key),
    capacity: () => opts.capacity,
    refillMs: () => opts.refillMs,
    maxEntries: opts.maxEntries,
    now: () => t,
    code: "GPS_RATE_LIMITED",
    message: "Envoi trop fréquent.",
  });
  const hit = (key: string) => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
    let outcome: unknown = "pending";
    limiter({ key } as unknown as Request, res, (err?: unknown) => { outcome = err ?? "next"; });
    return { outcome, headers };
  };
  return { limiter, hit, advance: (ms: number) => { t += ms; } };
}

describe("createKeyedRateLimiter", () => {
  it("rafale de `capacity` acceptée, la suivante refusée en 429 avec le code dédié et Retry-After", () => {
    const { hit } = harness({ capacity: 3, refillMs: 10_000 });
    for (let i = 0; i < 3; i++) expect(hit("u1:m1").outcome).toBe("next");
    const blocked = hit("u1:m1");
    expect(blocked.outcome).toBeInstanceOf(AppError);
    expect(blocked.outcome).toMatchObject({ status: 429, code: "GPS_RATE_LIMITED" });
    expect(blocked.headers["Retry-After"]).toBe("10");
  });

  it("recharge : un jeton toutes les refillMs, jamais au-delà de la capacité", () => {
    const { hit, advance } = harness({ capacity: 2, refillMs: 10_000 });
    hit("k"); hit("k");
    expect(hit("k").outcome).toBeInstanceOf(AppError);
    advance(9_999);
    expect(hit("k").outcome, "pas encore rechargé").toBeInstanceOf(AppError);
    advance(1);
    expect(hit("k").outcome).toBe("next");
    advance(10 * 60_000);
    expect(hit("k").outcome).toBe("next");
    expect(hit("k").outcome).toBe("next");
    expect(hit("k").outcome, "plafonné à la capacité après une longue pause").toBeInstanceOf(AppError);
  });

  it("Retry-After donne l'attente restante, arrondie à la seconde supérieure", () => {
    const { hit, advance } = harness({ capacity: 1, refillMs: 10_000 });
    hit("k");
    advance(2_500);
    expect(hit("k").headers["Retry-After"]).toBe("8");
  });

  it("clés isolées : épuiser une mission ne bloque ni une autre mission ni un autre chauffeur", () => {
    const { hit } = harness({ capacity: 1, refillMs: 10_000 });
    expect(hit("u1:m1").outcome).toBe("next");
    expect(hit("u1:m1").outcome).toBeInstanceOf(AppError);
    expect(hit("u1:m2").outcome).toBe("next");
    expect(hit("u2:m1").outcome).toBe("next");
  });

  it("une requête refusée ne consomme rien : l'attente annoncée suffit", () => {
    const { hit, advance } = harness({ capacity: 1, refillMs: 10_000 });
    hit("k");
    for (let i = 0; i < 5; i++) hit("k");
    advance(10_000);
    expect(hit("k").outcome).toBe("next");
  });

  it("mémoire bornée : seaux pleins purgés d'abord, puis les plus anciens", () => {
    const { limiter, hit, advance } = harness({ capacity: 2, refillMs: 1_000, maxEntries: 50 });
    for (let i = 0; i < 200; i++) hit(`k${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(50);
    advance(5_000);
    hit("fresh");
    expect(limiter.size(), "seaux rechargés purgés").toBe(1);
  });
});
