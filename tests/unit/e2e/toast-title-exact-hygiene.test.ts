import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";

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
async function toastTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  const pattern = /toast\(\s*\{[^}]*?\btitle:\s*(["'`])([^"'`]+)\1/g;
  for (const [, text] of await readRepoFiles(repoFiles({ under: ["client/src"], match: /\.tsx?$/ }))) {
    for (const match of text.matchAll(pattern)) titles.add(match[2]);
  }
  return titles;
}

describe("titres de toast affirmés dans les e2e", () => {
  it("trouve des titres de toast (garde contre une heuristique devenue muette)", async () => {
    expect((await toastTitles()).has("Problème signalé")).toBe(true);
  }, REPO_SCAN_TIMEOUT_MS);

  it("chaque getByText d'un titre de toast porte { exact: true }", async () => {
    const titles = await toastTitles();
    const offenders: string[] = [];
    for (const [file, source] of await readRepoFiles(repoFiles({ under: ["e2e"], match: /\.ts$/ }))) {
      for (const match of source.matchAll(/getByText\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
        if (!titles.has(match[2])) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line} getByText("${match[2]}")`);
      }
    }
    expect(offenders, "ajouter { exact: true } : le Toast Radix duplique le titre dans un span aria-live").toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
