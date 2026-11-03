import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Un e2e qui affirme le titre d'un toast le cherche avec `{ exact: true }`.
 *
 * Le Toast Radix annonce aussi son contenu dans un `<span aria-live>` passager
 * (« Notification <titre><description> »). Pendant cette fenêtre, `getByText("<titre>")`
 * sans `exact` résout deux éléments et le mode strict de Playwright échoue :
 * DRV2-1 (spec 19) était rouge environ une fois sur trois pour cette seule raison.
 *
 * Heuristique : titres littéraux passés à `toast({ title: "…" })` dans `client/src`,
 * puis tout `getByText("<titre>")` sans second argument dans `e2e/`.
 */
const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}

function toastTitles(): Set<string> {
  const titles = new Set<string>();
  const pattern = /toast\(\s*\{[^}]*?\btitle:\s*(["'`])([^"'`]+)\1/g;
  for (const file of files(join(root, "client/src"), /\.tsx?$/)) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) titles.add(match[2]);
  }
  return titles;
}

describe("titres de toast affirmés dans les e2e", () => {
  it("trouve des titres de toast (garde contre une heuristique devenue muette)", () => {
    expect(toastTitles().has("Problème signalé")).toBe(true);
  });

  it("chaque getByText d'un titre de toast porte { exact: true }", () => {
    const titles = toastTitles();
    const offenders: string[] = [];
    for (const file of files(join(root, "e2e"), /\.ts$/)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/getByText\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
        if (!titles.has(match[2])) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(root, file).replace(/\\/g, "/")}:${line} getByText("${match[2]}")`);
      }
    }
    expect(offenders, "ajouter { exact: true } : le Toast Radix duplique le titre dans un span aria-live").toEqual([]);
  });
});
