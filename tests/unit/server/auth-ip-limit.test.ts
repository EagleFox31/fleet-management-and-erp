import express from "express";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createIpFailureLimiter } from "../../../server/middleware/auth-ip-limit";
import { errorHandler, errorResponseGuard } from "../../../server/middleware/error-handler";
import { loginLockoutGuard } from "../../../server/middleware/login-lockout-guard";
import { EMPTY_LOCK_STATE, MemoryLockoutStore, reservedLockState } from "../../../server/services/login-lockout-service";

type Res = { status: number; body: any; retryAfter?: string };

function post(port: number, body: unknown, ip?: string): Promise<Res> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request(
      {
        port,
        method: "POST",
        path: "/login",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          ...(ip ? { "x-forwarded-for": ip } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, body: JSON.parse(b || "{}"), retryAfter: res.headers["retry-after"] as string }),
        );
      },
    );
    r.end(data);
  });
}

async function withApp(mount: (app: express.Express) => void, run: (port: number) => Promise<void>) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(errorResponseGuard);
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    await run((server.address() as any).port);
  } finally {
    server.close();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const handler: express.RequestHandler = (req, res) => {
  if (!req.body.password) return res.status(400).json({});
  if (req.body.password === "boom") return res.status(500).json({});
  res.status(req.body.password === "ok" ? 200 : 401).json({});
};

describe("createIpFailureLimiter", () => {
  it("plafond d'échecs par IP : 429 + Retry-After, sans rien dire du compte", async () => {
    let t = 1_000_000;
    const limiter = createIpFailureLimiter({ maxFailures: () => 2, windowMs: () => 60_000, now: () => t });
    await withApp((app) => app.post("/login", limiter, handler), async (port) => {
      expect((await post(port, { username: "a", password: "x" }, "203.0.113.1")).status).toBe(401);
      expect((await post(port, { username: "b", password: "x" }, "203.0.113.1")).status).toBe(401);
      const blocked = await post(port, { username: "cible", password: "ok" }, "203.0.113.1");
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
      expect(JSON.stringify(blocked.body)).not.toContain("cible");
      expect(Number(blocked.retryAfter)).toBe(60);
      expect((await post(port, { username: "cible", password: "ok" }, "203.0.113.2")).status, "autre IP").toBe(200);
      t += 60_000;
      expect((await post(port, { username: "cible", password: "ok" }, "203.0.113.1")).status, "fenêtre expirée").toBe(200);
    });
  });

  it("succès intercalés : chacun ne rend que son propre jeton, aucun échec n'est libéré", async () => {
    const limiter = createIpFailureLimiter({ maxFailures: () => 3, windowMs: () => 60_000 });
    await withApp((app) => app.post("/login", limiter, handler), async (port) => {
      for (let i = 0; i < 3; i++) {
        expect((await post(port, { username: `v${i}`, password: "x" }, "203.0.113.9")).status).toBe(401);
        await settle();
        if (i === 2) break;
        for (let k = 0; k < 5; k++) expect((await post(port, { username: "me", password: "ok" }, "203.0.113.9")).status).toBe(200);
        await settle();
      }
      // 3 échecs : plafond atteint malgré 10 succès intercalés.
      expect((await post(port, { username: "v9", password: "x" }, "203.0.113.9")).status).toBe(429);
      expect((await post(port, { username: "me", password: "ok" }, "203.0.113.9")).status).toBe(429);
    });
  });

  it("une 5xx reste comptée, une 400 est rendue", async () => {
    const limiter = createIpFailureLimiter({ maxFailures: () => 2, windowMs: () => 60_000 });
    await withApp((app) => app.post("/login", limiter, handler), async (port) => {
      for (let i = 0; i < 5; i++) expect((await post(port, { username: "a" }, "203.0.113.5")).status).toBe(400);
      await settle();
      expect((await post(port, { username: "a", password: "boom" }, "203.0.113.5")).status).toBe(500);
      expect((await post(port, { username: "a", password: "boom" }, "203.0.113.5")).status).toBe(500);
      await settle();
      expect((await post(port, { username: "a", password: "ok" }, "203.0.113.5")).status).toBe(429);
    });
  });

  it("X-Forwarded-For : sous trust proxy 1, seul le dernier saut compte", async () => {
    const limiter = createIpFailureLimiter({ maxFailures: () => 1, windowMs: () => 60_000 });
    await withApp((app) => app.post("/login", limiter, handler), async (port) => {
      expect((await post(port, { username: "a", password: "x" }, "1.1.1.1, 203.0.113.7")).status).toBe(401);
      expect((await post(port, { username: "a", password: "x" }, "2.2.2.2, 203.0.113.7")).status, "entrée de gauche forgée").toBe(429);
    });
  });

  it("mémoire bornée : jamais plus de maxEntries adresses, fenêtres expirées purgées d'abord", async () => {
    let t = 0;
    const limiter = createIpFailureLimiter({ maxFailures: () => 5, windowMs: () => 1_000, maxEntries: 50, now: () => t });
    await withApp((app) => app.post("/login", limiter, handler), async (port) => {
      for (let i = 0; i < 200; i++) await post(port, { username: "a", password: "x" }, `10.0.0.${i}`);
      expect(limiter.size()).toBeLessThanOrEqual(50);
      t += 2_000;
      for (let i = 0; i < 50; i++) await post(port, { username: "a", password: "x" }, `10.9.9.${i}`);
      expect(limiter.size()).toBeLessThanOrEqual(50);
    });
  });
});

describe("loginLockoutGuard : réservation avant le handler", () => {
  it("rafale simultanée : au plus maxAttempts vérifications, les autres 429", async () => {
    const store = new MemoryLockoutStore();
    let checked = 0;
    await withApp(
      (app) =>
        app.post("/login", loginLockoutGuard({ store }), async (_req, res) => {
          checked += 1;
          await new Promise((r) => setTimeout(r, 30)); // travail coûteux (bcrypt)
          res.status(401).json({});
        }),
      async (port) => {
        const results = await Promise.all(Array.from({ length: 20 }, () => post(port, { username: "ghost", password: "x" })));
        expect(results.filter((r) => r.status === 401).length).toBe(5);
        expect(checked).toBe(5);
        expect(results.filter((r) => r.status === 429).length).toBe(15);
      },
    );
  });

  it("400 et 5xx rendues : seuls les 401 consomment le seuil", async () => {
    const store = new MemoryLockoutStore();
    await withApp((app) => app.post("/login", loginLockoutGuard({ store }), handler), async (port) => {
      for (let i = 0; i < 10; i++) expect((await post(port, { username: "u" })).status).toBe(400);
      await settle();
      expect((await store.get("u")).failedCount).toBe(0);
      for (let i = 0; i < 10; i++) expect((await post(port, { username: "u", password: "boom" })).status).toBe(500);
      await settle();
      expect((await store.get("u")).failedCount).toBe(0);
      for (let i = 0; i < 5; i++) expect((await post(port, { username: "u", password: "x" })).status).toBe(401);
      await settle();
      expect((await post(port, { username: "u", password: "ok" })).status).toBe(429);
    });
  });

  it("compteur en panne : 503 sans appeler le handler, aucun secret vérifié", async () => {
    const store = new MemoryLockoutStore();
    store.reserve = () => Promise.reject(new Error("base indisponible"));
    let checked = 0;
    await withApp(
      (app) =>
        app.post("/login", loginLockoutGuard({ store }), (_req, res) => {
          checked += 1;
          res.status(401).json({});
        }),
      async (port) => {
        const results = await Promise.all(Array.from({ length: 5 }, () => post(port, { username: "u", password: "x" })));
        expect(results.map((r) => r.status)).toEqual([503, 503, 503, 503, 503]);
        expect(JSON.stringify(results[0].body)).not.toContain("base indisponible");
        expect(checked).toBe(0);
      },
    );
  });

  it("reservedLockState : verrou posé au premier dépassement, verrou expiré repart de zéro", () => {
    const cfg = { maxAttempts: 2, lockMinutes: 15 };
    const t0 = new Date("2026-11-04T08:00:00Z");
    let r = reservedLockState(EMPTY_LOCK_STATE, t0, cfg);
    expect(r.allowed).toBe(true);
    r = reservedLockState(r.state, t0, cfg);
    expect(r.allowed).toBe(true);
    r = reservedLockState(r.state, t0, cfg);
    expect(r).toMatchObject({ allowed: false, state: { failedCount: 3 } });
    expect(r.state.lockedUntil?.getTime()).toBe(t0.getTime() + 15 * 60_000);
    const later = new Date(t0.getTime() + 16 * 60_000);
    expect(reservedLockState(r.state, later, cfg)).toMatchObject({ allowed: true, state: { failedCount: 1, lockedUntil: null } });
  });
});
