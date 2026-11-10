import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

describe("journal du lot V5b-3b", () => {
  it("vit dans docs/journal/fe-v5b-2.md, plus dans docs/qa/journal/", () => {
    const journal = readFileSync(resolve(root, "docs/journal/fe-v5b-2.md"), "utf8");
    expect(journal).toContain("V5b-3b : restauration de la lecture hors ligne au démarrage");
    expect(journal).toContain("Audit sécurité de 0a et relecture fonctionnelle");
    const dir = resolve(root, "docs/qa/journal");
    const fragments = existsSync(dir) ? readdirSync(dir) : [];
    expect(fragments.filter((name) => name.includes("v5b-3b-restauration-demarrage"))).toEqual([]);
  });
});
