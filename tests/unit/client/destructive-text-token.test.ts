import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("jeton --destructive-text", () => {
  const css = read("client/src/index.css");
  const darkAt = css.indexOf(".dark {");

  it("est defini en theme clair et sombre", () => {
    expect(css.slice(0, darkAt)).toMatch(/--destructive-text:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/);
    expect(css.slice(darkAt)).toMatch(/--destructive-text:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/);
  });

  it("est mappe en classe tailwind text-destructive-text", () => {
    expect(read("tailwind.config.ts")).toMatch(/destructive:\s*\{[^}]*text:\s*"hsl\(var\(--destructive-text\)\)"/);
  });

  it("atteint AA et au moins le contraste de warning-text sur le fond compose", async () => {
    const modulePath = resolve(root, "scripts/contrast-semantic-text.mjs");
    const { compute } = (await import(/* @vite-ignore */ modulePath)) as {
      compute: () => Record<string, { destructiveTexte: number; warningTexte: number }>;
    };
    for (const [theme, r] of Object.entries(compute())) {
      expect(r.destructiveTexte, theme).toBeGreaterThanOrEqual(4.5);
      expect(r.destructiveTexte, theme).toBeGreaterThanOrEqual(r.warningTexte);
    }
  });

  it("les cartes d'incompatibilite de missions/new n'utilisent plus text-destructive sur bg-destructive/10", () => {
    const src = read("client/src/pages/missions/new.tsx");
    const cartes = src.split("\n").filter((l) => l.includes("border-destructive/30") && l.includes("bg-destructive/10") && !l.includes("p-3"));
    expect(cartes.length).toBe(2);
    for (const l of cartes) {
      expect(l).toContain("text-destructive-text");
      expect(l).not.toMatch(/text-destructive(?!-)/);
    }
  });

  it("vehicle-documents n'utilise plus text-destructive sur bg-destructive/10", () => {
    const src = read("client/src/components/vehicles/vehicle-documents.tsx");
    const lignes = src.split("\n").filter((l) => l.includes("bg-destructive/10"));
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(l).toContain("text-destructive-text");
      expect(l).not.toMatch(/text-destructive(?!-)/);
    }
  });
});
