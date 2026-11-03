import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEV_FALLBACK_SESSION_SECRET,
  SESSION_SECRET_MIN_LENGTH,
  SessionSecretError,
  resolveSessionSecret,
} from "../../../server/lib/session-secret";

const STRONG = "k".repeat(SESSION_SECRET_MIN_LENGTH);

describe("resolveSessionSecret : production", () => {
  it.each([
    ["absent", undefined],
    ["vide", "   "],
    ["trop court", "k".repeat(SESSION_SECRET_MIN_LENGTH - 1)],
    ["repli public du code", DEV_FALLBACK_SESSION_SECRET],
    ["exemple de .env.example", "change-me-in-dev"],
  ])("%s : démarrage refusé, message actionnable sans la valeur", (_label, secret) => {
    const warn = vi.fn();
    let error: unknown;
    try {
      resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: secret }, warn);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionSecretError);
    const message = (error as Error).message;
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).toMatch(new RegExp(`${SESSION_SECRET_MIN_LENGTH} caractères`));
    if (secret && secret.trim()) expect(message).not.toContain(secret);
    expect(warn).not.toHaveBeenCalled();
  });

  it(`secret de ${SESSION_SECRET_MIN_LENGTH} caractères : accepté tel quel, sans avertissement`, () => {
    const warn = vi.fn();
    expect(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: STRONG }, warn)).toBe(STRONG);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveSessionSecret : hors production", () => {
  it.each(["development", "test", undefined])("NODE_ENV=%s, secret absent : repli de développement et avertissement", (nodeEnv) => {
    const warn = vi.fn();
    expect(resolveSessionSecret({ NODE_ENV: nodeEnv }, warn)).toBe(DEV_FALLBACK_SESSION_SECRET);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/production/);
  });

  it("secret court : gardé, avec avertissement", () => {
    const warn = vi.fn();
    expect(resolveSessionSecret({ NODE_ENV: "development", SESSION_SECRET: "court" }, warn)).toBe("court");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("secret solide : aucun avertissement", () => {
    const warn = vi.fn();
    expect(resolveSessionSecret({ NODE_ENV: "development", SESSION_SECRET: STRONG }, warn)).toBe(STRONG);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("server/middleware/session.ts : garde-fou", () => {
  it("le secret passe par resolveSessionSecret, sans repli littéral", () => {
    const source = readFileSync(resolve(__dirname, "../../../server/middleware/session.ts"), "utf8");
    expect(source).toContain("resolveSessionSecret(process.env");
    expect(source).not.toMatch(/SESSION_SECRET\s*(\|\||\?\?)/);
    expect(source).not.toContain(DEV_FALLBACK_SESSION_SECRET);
  });
});
