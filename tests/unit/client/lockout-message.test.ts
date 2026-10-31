import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { formatLockTime, lockoutMessageOf } from "@/lib/lockout-message";

const locked = (lockedUntil: string) =>
  new ApiError(429, "Trop de tentatives", { message: "Trop de tentatives", code: "RATE_LIMITED", lockedUntil });

describe("message de compte verrouillé", () => {
  it("formate l'heure locale sur deux chiffres", () => {
    const d = new Date(2026, 9, 30, 9, 5);
    expect(formatLockTime(d.toISOString())).toBe("09:05");
  });

  it("rejette une date invalide", () => {
    expect(formatLockTime("pas une date")).toBeNull();
  });

  it("un 429 de verrouillage donne l'heure de fin", () => {
    const d = new Date(2026, 9, 30, 14, 35);
    expect(lockoutMessageOf(locked(d.toISOString()))).toBe("Compte verrouillé jusqu'à 14:35.");
  });

  it("un autre 429 ou une autre erreur donne null", () => {
    expect(lockoutMessageOf(new ApiError(429, "x", { message: "x", code: "RATE_LIMITED" }))).toBeNull();
    expect(lockoutMessageOf(new ApiError(401, "x", {}))).toBeNull();
    expect(lockoutMessageOf(new Error("boom"))).toBeNull();
  });
});
