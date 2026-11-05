import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Cliquet : toute paire « text-<jeton> + bg-<jeton>[/alpha] » d'une meme ligne de client/src doit atteindre 4,5
// en clair et en sombre, sauf paires gelees (decision de marque en attente : vert primary).
const root = process.cwd();
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []));
const TOKENS = new Set([
  "background", "foreground", "card", "card-foreground", "muted", "muted-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "destructive-text",
  "success", "success-foreground", "warning", "warning-foreground", "warning-text",
]);
// Gel : le vert de marque (primary) est une decision de design ouverte ; ne peut que se reduire.
const GELES = new Set(["primary sur primary/10", "primary sur primary/15", "primary sur primary/20", "primary-foreground sur primary"]);

describe("paires texte/fond par jeton, sur une meme ligne", () => {
  it("aucune paire sous 4,5 hors liste gelee", async () => {
    const { hsl, ratio, over, THEMES } = (await import(/* @vite-ignore */ resolve(root, "scripts/contrast-semantic-text.mjs"))) as any;
    const re = /(?<![\w:-])(text|bg)-([a-z-]+?)(?:\/(\d+))?(?=[\s"'`}]|$)/g;
    const bad = new Map<string, string[]>();
    for (const f of walk(resolve(root, "client/src"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const t: [string, number][] = [];
        const b: [string, number][] = [];
        for (const m of line.matchAll(re)) {
          if (!TOKENS.has(m[2])) continue;
          (m[1] === "text" ? t : b).push([m[2], m[3] ? +m[3] / 100 : 1]);
        }
        for (const [tn, ta] of t) for (const [bn, ba] of b) {
          const ok = Object.values(THEMES).every((th: any) => {
            const bg = over(hsl(th[bn]), hsl(th.background), ba);
            return ratio(over(hsl(th[tn]), bg, ta), bg) >= 4.5;
          });
          if (ok) continue;
          const key = `${tn}${ta < 1 ? "/" + Math.round(ta * 100) : ""} sur ${bn}${ba < 1 ? "/" + Math.round(ba * 100) : ""}`;
          if (GELES.has(key)) continue;
          (bad.get(key) ?? bad.set(key, []).get(key)!).push(`${relative(root, f).replace(/\\/g, "/")}:${i + 1}`);
        }
      });
    }
    expect(Object.fromEntries(bad)).toEqual({});
  });
});
