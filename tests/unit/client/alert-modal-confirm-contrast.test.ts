import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Les boutons de confirmation d'AlertModal posent `text-white` sur un fond en jeton : le blanc doit atteindre 4,5
// (AA) sur ce fond en mode clair, le seul supporte (.claude/design-system.md). `token-pairs-contrast` ne le voit pas :
// ces classes sont dans un objet, pas dans cn(...), et `text-white` n'est pas un jeton.
// Un survol qui eclaircit le fond (`hover:bg-<jeton>/NN`) est aussi refuse : le bouton doit s'assombrir.
const root = process.cwd();
const C = (await import(/* @vite-ignore */ resolve(root, "scripts/contrast-semantic-text.mjs"))) as unknown as {
  hsl: (v: number[]) => number[];
  ratio: (a: number[], b: number[]) => number;
  THEMES: Record<string, Record<string, number[]>>;
};

const src = readFileSync(resolve(root, "client/src/components/design-system/alert-modal.tsx"), "utf8");
const classes = [...src.matchAll(/confirmClass:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("boutons de confirmation d'AlertModal", () => {
  it("lit bien les variantes du composant", () => {
    expect(classes.length).toBeGreaterThanOrEqual(4);
  });

  it("texte blanc sur fond en jeton : 4,5 au moins en mode clair", () => {
    const bad = classes.flatMap((c) => {
      const bg = /(?<![\w:-])bg-([a-z-]+)(?![\w/-])/.exec(c)?.[1];
      if (!bg || !(bg in C.THEMES.clair) || !/(?<![\w-])text-white(?![\w-])/.test(c)) return [];
      const r = C.ratio([255, 255, 255], C.hsl(C.THEMES.clair[bg]));
      return r >= 4.5 ? [] : [`${c} : ${r.toFixed(2)}`];
    });
    expect(bad).toEqual([]);
  });

  it("le survol assombrit : aucun hover:bg-<jeton>/NN", () => {
    expect(classes.filter((c) => /hover:bg-[a-z-]+\/\d+/.test(c))).toEqual([]);
  });
});
