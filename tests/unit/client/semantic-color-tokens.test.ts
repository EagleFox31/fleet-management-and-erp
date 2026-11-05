import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Couleurs sémantiques (succès, alerte, danger) : jetons du design system uniquement.
const FILES = [
  "client/src/pages/missions/new.tsx",
  "client/src/components/drivers/cpc-update-form.tsx",
];
const HARDCODED = /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:emerald|green|red|amber|yellow|orange|rose)-\d{2,3}\b/;

describe("jetons de couleur sémantiques", () => {
  for (const file of FILES) {
    it(`${file} n'utilise aucune palette Tailwind en dur`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const hits = source
        .split(/\r?\n/)
        .map((line, i) => ({ line: i + 1, match: line.match(HARDCODED)?.[0] }))
        .filter((h) => h.match);
      expect(hits).toEqual([]);
    });
  }
});

describe("contraste du formulaire CPC", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/components/drivers/cpc-update-form.tsx"), "utf8");
  const toneLines = source.split(/\r?\n/).filter((l) => /^\s*(success|warning|danger|neutral):/.test(l));

  it("le badge expiré n'est pas bg-destructive plein avec texte destructive-foreground", () => {
    expect(source).not.toMatch(/bg-destructive text-destructive-foreground/);
  });

  it("aucun badge ne met text-muted-foreground sur bg-muted", () => {
    const bad = toneLines.filter((l) => /\bbg-muted\b/.test(l) && /\btext-muted-foreground\b/.test(l));
    expect(bad).toEqual([]);
  });
});
