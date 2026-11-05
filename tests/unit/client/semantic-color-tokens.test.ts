import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

type Couple = { label: string; clair: number; sombre: number; source: [string, string] | null };
const loadScript = async () =>
  (await import(/* @vite-ignore */ resolve(process.cwd(), "scripts/contrast-semantic-text.mjs"))) as {
    computeCouples: () => Couple[];
    EXCLUS_HISTORIQUE: string[];
  };

describe("contraste WCAG des couples employes", () => {
  it("tous les couples hors liste d'exclusion fixe atteignent 4,5 en clair et en sombre", async () => {
    const { computeCouples, EXCLUS_HISTORIQUE } = await loadScript();
    const all = computeCouples();
    const couples = all.filter((c) => !EXCLUS_HISTORIQUE.includes(c.label));
    expect(couples.length).toBeGreaterThan(5);
    for (const c of couples) {
      expect(c.clair, `${c.label} clair`).toBeGreaterThanOrEqual(4.5);
      expect(c.sombre, `${c.label} sombre`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("la liste d'exclusion ne reference que des couples existants", async () => {
    const { computeCouples, EXCLUS_HISTORIQUE } = await loadScript();
    const labels = computeCouples().map((c) => c.label);
    for (const l of EXCLUS_HISTORIQUE) expect(labels, l).toContain(l);
  });

  it("la liste d'exclusion est figee : libelles uniques, exactement les 2 couples historiques, sans lien au code", async () => {
    const { computeCouples, EXCLUS_HISTORIQUE } = await loadScript();
    expect(new Set(EXCLUS_HISTORIQUE).size).toBe(EXCLUS_HISTORIQUE.length);
    expect(new Set(computeCouples().map((c) => c.label)).size).toBe(computeCouples().length);
    expect(EXCLUS_HISTORIQUE).toEqual([
      "badge CPC valide sur carte muted ancien (success sur success/10 sur muted)",
      "destructive sur destructive/10 ancien (page)",
    ]);
    for (const c of computeCouples().filter((x) => EXCLUS_HISTORIQUE.includes(x.label))) expect(c.source, c.label).toBeNull();
  });

  it("chaque couple non exclu est relie a des classes presentes dans le code", async () => {
    const { computeCouples, EXCLUS_HISTORIQUE } = await loadScript();
    for (const c of computeCouples().filter((x) => !EXCLUS_HISTORIQUE.includes(x.label))) {
      if (!c.source) continue;
      const [file, motif] = c.source;
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src.includes(motif), `${c.label} : "${motif}" absent de ${file}`).toBe(true);
    }
  });
});

// Une chaine de classes (litteral entre guillemets) peut s'etendre sur plusieurs lignes : on la teste entiere.
const classStrings = (src: string) => [...src.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*?)\1/gs)].map((m) => m[2]);

describe("texte destructif sur fond teinte", () => {
  for (const file of FILES) {
    it(`${file} : aucune chaine de classes ne combine text-destructive et bg-destructive/10`, () => {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      const teintees = classStrings(src).filter((s) => s.includes("bg-destructive/10"));
      expect(teintees.length).toBeGreaterThan(0);
      for (const s of teintees) expect(s).not.toMatch(/(?<![\w-])text-destructive(?![\w-])/);
    });
  }
});

describe("text-destructive nu interdit partout dans client/src", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  // Liste gelee : cas dynamiques justifies (classe composee a l'execution). Vide a ce jour.
  const GELES: string[] = [];
  it("seul text-destructive-text est employe (le fond plein destructive garde destructive-foreground)", () => {
    const re = /(?<![\w-])text-destructive(?![\w-])/;
    const hits = walk(resolve(process.cwd(), "client/src"))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split(/\r?\n/)
          .map((l, i) => (re.test(l) ? `${relative(process.cwd(), f).replace(/\\/g, "/")}:${i + 1}` : ""))
          .filter(Boolean),
      )
      .filter((h) => !GELES.includes(h));
    expect(hits).toEqual([]);
  });
});
