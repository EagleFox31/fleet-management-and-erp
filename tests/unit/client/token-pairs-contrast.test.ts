import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Cliquet : toute paire « text-<jeton> + bg-<jeton>[/alpha] » d'une meme ligne de client/src doit atteindre 4,5
// en clair et en sombre, sauf paires gelees (decision de marque en attente : vert primary).
const root = process.cwd();
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []));
const TOKENS = new Set([
  "background", "foreground", "card", "card-foreground", "muted", "muted-foreground", "primary", "primary-foreground", "primary-text",
  "secondary", "secondary-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "destructive-text",
  "popover", "popover-foreground", "success", "success-foreground", "warning", "warning-foreground", "warning-text",
]);
// Liste gelee, par "fichier:ligne du bloc" : vide (le vert primary a ete corrige par jeton, voir docs/journal/fe-primary-31-primary-text.md).
const GELES = new Set<string>();

// Blocs de classes : tout `cn(...)`, `className={...}` ou `className="..."`, groupes par equilibrage des parentheses/accolades,
// donc une paire etalee sur plusieurs lignes d'un meme bloc est vue. Limite : deux classes posees dans deux blocs distincts
// (ex. parent et enfant) ne sont pas comparees.
function blocks(src: string): { text: string; line: number; alt?: boolean }[] {
  const out: { text: string; line: number; alt?: boolean }[] = [];
  const starts = /cn\(|cva\(|classNames?=\{|className=(?=["'`])/g;
  for (const m of src.matchAll(starts)) {
    const i = m.index! + m[0].length;
    let end = i;
    if (m[0].endsWith("(") || m[0].endsWith("{")) {
      const open = m[0].endsWith("(") ? "(" : "{";
      const close = open === "(" ? ")" : "}";
      let depth = 1;
      for (end = i; end < src.length && depth > 0; end++) {
        if (src[end] === open) depth++;
        else if (src[end] === close) depth--;
      }
    } else {
      const q = src[i];
      end = src.indexOf(q, i + 1) + 1;
    }
    out.push({ alt: /^(cva|classNames)/.test(m[0]), text: src.slice(i, end), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("paires texte/fond par jeton, dans un meme bloc de classes", () => {
  it("aucune paire sous 4,5 hors liste gelee (fichier:ligne)", async () => {
    const { hsl, ratio, over, THEMES } = (await import(/* @vite-ignore */ resolve(root, "scripts/contrast-semantic-text.mjs"))) as any;
    const re = /(?<![\w:-])(text|bg)-([a-z-]+?)(?:\/(\d+))?(?=[\s"'`}),]|$)/g;
    const bad = new Map<string, string[]>();
    for (const f of walk(resolve(root, "client/src"))) {
      const rel = relative(root, f).split(sep).join("/");
      // branches d'un ternaire (` ? ... : ...`) : la base (premiere partie) est comparee a chaque branche, jamais les branches entre elles
      const segs = blocks(readFileSync(f, "utf8")).flatMap((b) => {
        if (b.alt) {
          // cva( / classNames={{ }} : chaque litteral est une variante, la premiere de cva( est la base commune
          const lits = [...b.text.matchAll(/(["'`])((?:(?!\1)[^\\])*?)\1/g)].map((m) => m[2]);
          const base = /^\s*["'`]/.test(b.text) ? (lits[0] ?? "") : "";
          return lits.map((l) => ({ text: base + " " + l, line: b.line }));
        }
        const parts = b.text.split(/\s\?\s|\s:\s/);
        if (parts.length === 1) return [{ text: b.text, line: b.line }];
        return parts.slice(1).map((br) => ({ text: parts[0] + " " + br, line: b.line }));
      });
      for (const blk of segs) {
        const t: [string, number][] = [];
        const bg: [string, number][] = [];
        for (const m of blk.text.matchAll(re)) {
          if (!TOKENS.has(m[2])) continue;
          (m[1] === "text" ? t : bg).push([m[2], m[3] ? +m[3] / 100 : 1]);
        }
        for (const [tn, ta] of t) for (const [bn, ba] of bg) {
          const ok = Object.values(THEMES).every((th: any) => {
            const c = over(hsl(th[bn]), hsl(th.background), ba);
            return ratio(over(hsl(th[tn]), c, ta), c) >= 4.5;
          });
          if (ok) continue;
          const where = `${rel}:${blk.line}`;
          if (GELES.has(where)) continue;
          const key = `${tn}${ta < 1 ? "/" + Math.round(ta * 100) : ""} sur ${bn}${ba < 1 ? "/" + Math.round(ba * 100) : ""}`;
          (bad.get(key) ?? bad.set(key, []).get(key)!).push(where);
          // doublons (meme bloc, plusieurs branches) : dedupliques ci-dessous
        }
      }
    }
    expect(Object.fromEntries([...bad].map(([k, v]) => [k, [...new Set(v)]]))).toEqual({});
  });

  it("le detecteur voit cva(, classNames={{ }} et les branches d'un ternaire", () => {
    expect(blocks('const v = cva("base", { variants: { a: "bg-secondary/10 text-secondary" } })').some((b) => /bg-secondary/.test(b.text))).toBe(true);
    expect(blocks('<X classNames={{ day: "bg-primary text-muted-foreground" }} />').some((b) => /bg-primary/.test(b.text))).toBe(true);
  });

  it("le detecteur voit une paire etalee sur plusieurs lignes", () => {
    const found = blocks('x = cn(\n  "bg-secondary/10",\n  "text-secondary",\n)');
    expect(found).toHaveLength(1);
    expect(found[0].text).toMatch(/bg-secondary.*text-secondary/s);
  });
});

describe("text-primary nu interdit (le texte vert passe par text-primary-text)", () => {
  it("aucune occurrence dans client/src", () => {
    const re = /(?<![\w-])text-primary(?![\w-])/;
    const hits = walk(resolve(root, "client/src")).filter((f) => readFileSync(f, "utf8").split(/\r?\n/).some((l) => re.test(l)));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });
});
