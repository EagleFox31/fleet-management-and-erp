import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Cliquet : toute paire « text-<jeton> + bg-<jeton>[/alpha] » posee ensemble sur un meme element de client/src doit
// atteindre 4,5 en clair et en sombre. Liste gelee (par fichier:ligne de la classe fautive) : vide.
//
// Ce qui est compare (ensemble de classes qui peuvent s'appliquer ensemble) :
//  - cn(...), className={...}, className="..." : le bloc entier ; pour un ternaire, la base contre chaque branche ;
//  - cva(...) : la base + une valeur de chaque axe de `variants` (produit croise), et chaque classe de `compoundVariants`
//    ajoutee a ces combinaisons ;
//  - classNames={{ cle: "..." }} : chaque litteral seul (chaque cle cible un element different).
// Limite : deux classes posees dans deux blocs distincts (ex. parent et enfant) ne sont pas comparees.
const root = process.cwd();
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []));
const TOKENS = new Set([
  "background", "foreground", "card", "card-foreground", "muted", "muted-foreground", "primary", "primary-foreground", "primary-text",
  "secondary", "secondary-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "destructive-text",
  "popover", "popover-foreground", "success", "success-foreground", "warning", "warning-foreground", "warning-text",
]);
const GELES = new Set<string>();

type Frag = { text: string; off: number };
type Block = { kind: "cn" | "cva" | "classNames" | "attr"; start: number; end: number };

/** Index juste apres le `close` qui ferme l'`open` deja ouvert avant `from`. */
function closeOf(src: string, from: number, open: string, close: string): number {
  let depth = 1;
  let i = from;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) depth--;
  }
  return i;
}

function blocks(src: string): Block[] {
  const out: Block[] = [];
  for (const m of src.matchAll(/cn\(|cva\(|classNames?=\{|className=(?=["'`])/g)) {
    const start = m.index! + m[0].length;
    const kind = m[0] === "cn(" ? "cn" : m[0] === "cva(" ? "cva" : m[0].startsWith("classNames") ? "classNames" : "attr";
    let end: number;
    if (m[0].endsWith("(")) end = closeOf(src, start, "(", ")");
    else if (m[0].endsWith("{")) end = closeOf(src, start, "{", "}");
    else end = src.indexOf(src[start], start + 1) + 1;
    out.push({ kind, start, end });
  }
  return out;
}

function literals(src: string, from: number, to: number): Frag[] {
  const slice = src.slice(from, to);
  return [...slice.matchAll(/(["'`])((?:(?!\1)[^\\])*?)\1/g)].map((m) => ({ text: m[2], off: from + m.index! + 1 }));
}

/** Corps `{ ... }` de la propriete `name:` dans [from, to), sous la forme [debut, fin) ; null si absente. */
function propBody(src: string, name: string, from: number, to: number, open = "{", close = "}"): [number, number] | null {
  const m = new RegExp(`\\b${name}\\s*:\\s*\\${open}`).exec(src.slice(from, to));
  if (!m) return null;
  const start = from + m.index + m[0].length;
  return [start, closeOf(src, start, open, close) - 1];
}

function splitTernary(text: string, off: number): Frag[] {
  const parts: Frag[] = [];
  let last = 0;
  for (const m of text.matchAll(/\s\?\s|\s:\s/g)) {
    parts.push({ text: text.slice(last, m.index), off: off + last });
    last = m.index! + m[0].length;
  }
  parts.push({ text: text.slice(last), off: off + last });
  return parts;
}

const product = <T,>(lists: T[][]): T[][] => lists.reduce<T[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]);

/** Ensembles de fragments de classes susceptibles de s'appliquer ensemble. */
function classSets(src: string, b: Block): Frag[][] {
  if (b.kind === "classNames") return literals(src, b.start, b.end).map((l) => [l]);
  if (b.kind === "cva") {
    const lits = literals(src, b.start, b.end);
    const base: Frag[] = /^\s*["'`]/.test(src.slice(b.start, b.end)) && lits[0] ? [lits[0]] : [];
    const axes: Frag[][] = [];
    const variants = propBody(src, "variants", b.start, b.end);
    if (variants) {
      for (let i = variants[0]; i < variants[1]; i++) {
        if (src[i] !== "{") continue;
        const end = closeOf(src, i + 1, "{", "}");
        axes.push(literals(src, i + 1, end - 1));
        i = end - 1;
      }
    }
    const combos = product(axes.length ? axes : [[]]).map((c) => [...base, ...c]);
    const compound = propBody(src, "compoundVariants", b.start, b.end, "[", "]");
    const extras = compound
      ? [...src.slice(compound[0], compound[1]).matchAll(/\bclass(?:Name)?\s*:\s*(["'`])((?:(?!\1)[^\\])*?)\1/g)].map((m) => ({
          text: m[2],
          off: compound[0] + m.index! + m[0].indexOf(m[2], m[0].indexOf(":")),
        }))
      : [];
    return [...combos, ...extras.flatMap((e) => combos.map((c) => [...c, e]))];
  }
  const parts = splitTernary(src.slice(b.start, b.end), b.start);
  return parts.length === 1 ? [parts] : parts.slice(1).map((br) => [parts[0], br]);
}

const lineAt = (src: string, off: number) => src.slice(0, off).split("\n").length;

type Contrast = { hsl: any; ratio: any; over: any; THEMES: Record<string, any> };
const C = (await import(/* @vite-ignore */ resolve(root, "scripts/contrast-semantic-text.mjs"))) as unknown as Contrast;
const TOKEN_RE = /(?<![\w:-])(text|bg)-([a-z-]+?)(?:\/(\d+))?(?=[\s"'`}),]|$)/g;

/** Paires sous 4,5 d'un source : cle lisible + ligne de la classe `text-*` fautive. */
function analyse(src: string): { key: string; line: number }[] {
  const found: { key: string; line: number }[] = [];
  for (const set of blocks(src).flatMap((b) => classSets(src, b))) {
    const t: [string, number, number][] = [];
    const bg: [string, number][] = [];
    for (const f of set) {
      for (const m of f.text.matchAll(TOKEN_RE)) {
        if (!TOKENS.has(m[2])) continue;
        const alpha = m[3] ? +m[3] / 100 : 1;
        if (m[1] === "text") t.push([m[2], alpha, f.off + m.index!]);
        else bg.push([m[2], alpha]);
      }
    }
    for (const [tn, ta, off] of t) for (const [bn, ba] of bg) {
      const ok = Object.values(C.THEMES).every((th: any) => {
        const c = C.over(C.hsl(th[bn]), C.hsl(th.background), ba);
        return C.ratio(C.over(C.hsl(th[tn]), c, ta), c) >= 4.5;
      });
      if (ok) continue;
      const pct = (a: number) => (a < 1 ? "/" + Math.round(a * 100) : "");
      found.push({ key: `${tn}${pct(ta)} sur ${bn}${pct(ba)}`, line: lineAt(src, off) });
    }
  }
  return found;
}

describe("paires texte/fond par jeton (cn, className, cva, classNames)", () => {
  it("aucune paire sous 4,5 hors liste gelee (fichier:ligne)", () => {
    const bad = new Map<string, Set<string>>();
    for (const f of walk(resolve(root, "client/src"))) {
      const rel = relative(root, f).split(sep).join("/");
      for (const { key, line } of analyse(readFileSync(f, "utf8"))) {
        if (GELES.has(`${rel}:${line}`)) continue;
        (bad.get(key) ?? bad.set(key, new Set()).get(key)!).add(`${rel}:${line}`);
      }
    }
    expect(Object.fromEntries([...bad].map(([k, v]) => [k, [...v]]))).toEqual({});
  });
});

describe("detecteur de paires", () => {
  const keys = (src: string) => analyse(src).map((x) => x.key);

  it("voit une paire etalee sur plusieurs lignes et signale la ligne de la classe fautive", () => {
    const src = 'x = cn(\n  "bg-secondary/10",\n  "p-2",\n  "text-secondary",\n)';
    expect(analyse(src)).toEqual([{ key: "secondary sur secondary/10", line: 4 }]);
  });

  it("compare la base de cn(...) a chaque branche d'un ternaire, pas les branches entre elles", () => {
    expect(keys('cn("text-primary-foreground", y ? "bg-primary/10" : "bg-muted")').sort()).toEqual([
      "primary-foreground sur muted",
      "primary-foreground sur primary/10",
    ]);
    expect(keys('cn(y ? "text-primary-foreground bg-primary" : "text-foreground bg-muted")')).toEqual([]);
  });

  it("cva : base + chaque variante d'un axe", () => {
    expect(keys('cva("text-secondary", { variants: { v: { a: "bg-secondary/10", b: "bg-muted" } } })').sort()).toEqual(["secondary sur muted", "secondary sur secondary/10"]);
  });

  it("cva : axes croises (texte d'un axe, fond d'un autre), mais jamais deux valeurs du meme axe", () => {
    const src = 'cva("p-2", { variants: { tone: { a: "text-secondary", b: "text-foreground" }, fill: { x: "bg-secondary/10", y: "bg-background" } } })';
    expect(keys(src).sort()).toEqual(["secondary sur background", "secondary sur secondary/10"]);
    const memeAxe = 'cva("p-2", { variants: { v: { a: "text-secondary", b: "bg-secondary/10" } } })';
    expect(keys(memeAxe)).toEqual([]);
  });

  it("cva : compoundVariants compares aux combinaisons, ligne = classe fautive", () => {
    const src = 'cva("text-secondary", {\n  variants: { v: { a: "p-1" } },\n  compoundVariants: [\n    { v: "a", class: "bg-secondary/10" },\n  ],\n})';
    expect(analyse(src)).toEqual([{ key: "secondary sur secondary/10", line: 1 }]);
    const sansFond = 'cva("text-foreground", { variants: { v: { a: "p-1" } }, compoundVariants: [{ v: "a", class: "bg-background" }] })';
    expect(keys(sansFond)).toEqual([]);
  });

  it("classNames={{ }} : chaque cle est un element distinct", () => {
    expect(keys('<X classNames={{ a: "bg-secondary/10", b: "text-secondary" }} />')).toEqual([]);
    expect(keys('<X classNames={{ a: "bg-secondary/10 text-secondary" }} />')).toEqual(["secondary sur secondary/10"]);
  });
});

describe("text-primary nu interdit (le texte vert passe par text-primary-text)", () => {
  it("aucune occurrence dans client/src", () => {
    const re = /(?<![\w-])text-primary(?![\w-])/;
    const hits = walk(resolve(root, "client/src")).filter((f) => readFileSync(f, "utf8").split(/\r?\n/).some((l) => re.test(l)));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });
});
