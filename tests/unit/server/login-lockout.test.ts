import express from "express";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { errorHandler, errorResponseGuard } from "../../../server/middleware/error-handler";
import { loginLockoutGuard } from "../../../server/middleware/login-lockout-guard";
import {
  EMPTY_LOCK_STATE,
  isLocked,
  lockKeyOrder,
  lockoutConfigFromEnv,
  MemoryLockoutStore,
} from "../../../server/services/login-lockout-service";
import { failLogin } from "../../support/lockout";

const cfg = { maxAttempts: 5, lockMinutes: 15 };
const t0 = new Date("2026-11-02T08:00:00Z");

describe("echec confirme (reservation puis confirmation)", () => {
  it("verrouille au 5e echec pour 15 min", async () => {
    const store = new MemoryLockoutStore();
    let s = EMPTY_LOCK_STATE;
    for (let i = 0; i < 4; i++) s = await failLogin(store, "u", t0, cfg);
    expect(isLocked(s, t0)).toBe(false);
    s = await failLogin(store, "u", t0, cfg);
    expect(s.failedCount).toBe(5);
    expect(s.lockedUntil!.getTime()).toBe(t0.getTime() + 15 * 60_000);
    expect(isLocked(s, new Date(t0.getTime() + 14 * 60_000))).toBe(true);
    expect(isLocked(s, new Date(t0.getTime() + 15 * 60_000))).toBe(false);
  });
  it("un verrou expire repart de zero", async () => {
    const store = new MemoryLockoutStore();
    for (let i = 0; i < 5; i++) await failLogin(store, "u", t0, cfg);
    const s = await failLogin(store, "u", new Date(t0.getTime() + 16 * 60_000), cfg);
    expect(s.failedCount).toBe(1);
  });
});

describe("lockKeyOrder : ordre de prise des verrous de cle", () => {
  it("meme ordre quel que soit l'ordre d'appel, sans doublon", () => {
    expect(lockKeyOrder(["pwd:b", "pin:2", "pwd:a", "pwd:b"])).toEqual(["pin:2", "pwd:a", "pwd:b"]);
    expect(lockKeyOrder(["pwd:a", "pwd:b", "pin:2"])).toEqual(lockKeyOrder(["pin:2", "pwd:b", "pwd:a"]));
    expect(lockKeyOrder("pwd:a")).toEqual(["pwd:a"]);
  });
});

describe("lockoutConfigFromEnv", () => {
  it("defauts, surcharge, valeurs invalides ignorees", () => {
    expect(lockoutConfigFromEnv({})).toEqual(cfg);
    expect(lockoutConfigFromEnv({ LOCKOUT_MAX_ATTEMPTS: "3", LOCKOUT_MINUTES: "1" } as NodeJS.ProcessEnv)).toEqual({
      maxAttempts: 3,
      lockMinutes: 1,
    });
    expect(lockoutConfigFromEnv({ LOCKOUT_MAX_ATTEMPTS: "abc", LOCKOUT_MINUTES: "-2" } as NodeJS.ProcessEnv)).toEqual(cfg);
  });
});

describe("loginLockoutGuard", () => {
  function post(port: number, username: string, password: string) {
    return new Promise<{ status: number; body: any }>((resolve) => {
      const data = JSON.stringify({ username, password });
      const r = http.request(
        { port, method: "POST", path: "/login", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(b || "{}") }));
        },
      );
      r.end(data);
    });
  }

  it("5 echecs puis 429 avec lockedUntil, nom inconnu inclus ; un succes remet a zero", async () => {
    const store = new MemoryLockoutStore();
    const app = express();
    app.use(express.json());
    app.use(errorResponseGuard);
    app.post("/login", loginLockoutGuard({ store }), (req, res) => res.status(req.body.password === "ok" ? 200 : 401).json({}));
    app.use(errorHandler);
    const server = app.listen(0);
    const port = (server.address() as any).port;
    const settle = () => new Promise((r) => setTimeout(r, 25));
    try {
      for (let i = 0; i < 4; i++) expect((await post(port, "Ghost", "bad")).status).toBe(401);
      await settle();
      expect((await post(port, " ghost ", "ok")).status).toBe(200);
      await settle();
      for (let i = 0; i < 5; i++) {
        expect((await post(port, "ghost", "bad")).status).toBe(401);
        await settle();
      }
      const blocked = await post(port, "GHOST", "ok");
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
      expect(Date.parse(blocked.body.lockedUntil)).toBeGreaterThan(Date.now());
    } finally {
      server.close();
    }
  });
});

describe("MemoryLockoutStore.reserve", () => {
  it("refuse sans modifier l'etat tant que le verrou est actif, puis repart de zero apres expiration", async () => {
    const store = new MemoryLockoutStore();
    let last = { allowed: true } as Awaited<ReturnType<MemoryLockoutStore["reserve"]>>;
    for (let i = 0; i < cfg.maxAttempts; i++) last = await store.reserve("bob", t0, cfg);
    expect(last.allowed).toBe(true);
    const locked = await store.reserve("bob", t0, cfg);
    expect(locked.allowed).toBe(false);
    const again = await store.reserve("bob", new Date(t0.getTime() + 60_000), cfg);
    expect(again.allowed).toBe(false);
    expect(again.state).toEqual(locked.state);
    const later = new Date(t0.getTime() + (cfg.lockMinutes + 1) * 60_000);
    const fresh = await store.reserve("bob", later, cfg);
    expect(fresh.allowed).toBe(true);
    expect(fresh.state.failedCount).toBe(1);
  });
});
