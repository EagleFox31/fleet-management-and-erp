import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `getTireRotationsForWorkOrder` journalisait les lignes entières (coût compris) par `console.log`.
 * Journal structuré seulement, et aucun coût ni ligne complète dans son contenu.
 */
const storage = readFileSync("server/storage.ts", "utf8");
const start = storage.indexOf("  async getTireRotationsForWorkOrder(");
const body = storage.slice(start, storage.indexOf("\n  async ", start + 1));

describe("rotations de pneus d'un OT : journal sans coût", () => {
  it("la méthode existe", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("aucun console.*", () => {
    expect(body).not.toMatch(/console\./);
  });

  it("les appels storageLog ne reçoivent ni les lignes ni le coût", () => {
    const calls = [...body.matchAll(/storageLog\.\w+\(([^;]*)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/\bcost\b/);
      expect(call).not.toMatch(/[{,]\s*rotations\s*[,}]|\brotations\s*:\s*rotations\b/);
    }
  });
});
