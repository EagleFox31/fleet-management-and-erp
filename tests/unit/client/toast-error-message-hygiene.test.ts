import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md §10 : un toast affiche `userMessageOf(error, repli)`, jamais `error.message`.
 *
 * `error.message` peut porter un message technique (réseau, JSON, exception JS) et ne
 * bénéficie ni du repli ni de la référence d'erreur. Ce test repère, dans le `title` ou
 * la `description` d'un affichage, toute lecture directe de `.message` sur une erreur :
 * `error.message`, `error?.message`, `err.message`, `e.message`, `xxxError.message`,
 * `(e as Error).message`, y compris dans un gabarit `${...}`.
 *
 * Les sites restants, tenus par une autre session, sont gelés ci-dessous avec leur nombre
 * d'occurrences. Égalité stricte : la liste ne peut que diminuer, et un site corrigé doit
 * en sortir.
 */
const FROZEN: Record<string, number> = {};

const root = fileURLToPath(new URL("../../..", import.meta.url));
const clientDir = join(root, "client", "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const errorIdent = String.raw`(?:\b(?:error|err|e|\w+Error|\w+Err)\s*\??\.\s*message\b|\(\s*\w+\s+as\s+\w+\s*\)\s*\??\.\s*message\b)`;
const sitePattern = new RegExp(String.raw`\b(?:description|title)\s*:[^\n]*?${errorIdent}`, "g");

export function countSites(source: string): number {
  // Une clé suivie d'un retour à la ligne (`description:\n  error.message`) est ramenée sur une ligne.
  const joined = source.replace(/\b(description|title)\s*:\s*\r?\n\s*/g, "$1: ");
  return [...joined.matchAll(sitePattern)].length;
}

describe("toasts : pas de error.message brut (AGENTS.md §10)", () => {
  it("la détection couvre les variantes", () => {
    const samples = [
      `toast({ description: error.message })`,
      `toast({ description: error?.message || "x" })`,
      `toast({ title: err.message })`,
      `toast({ description: e.message })`,
      "toast({ description: `Erreur : ${error.message}` })",
      `toast({ description: (e as Error).message })`,
      `toast({ description: uploadError.message })`,
      `toast({\n  description:\n    error.message,\n})`,
    ];
    for (const sample of samples) expect(countSites(sample), sample).toBe(1);
    expect(countSites(`toast({ description: userMessageOf(error, "x") })`)).toBe(0);
    expect(countSites(`toast({ description: data.message })`)).toBe(0);
  });

  it("aucun site hors de la liste gelée", () => {
    const found: Record<string, number> = {};
    for (const path of sources(clientDir)) {
      const n = countSites(readFileSync(path, "utf8"));
      if (n > 0) found[relative(root, path).split("\\").join("/")] = n;
    }
    expect(found).toEqual(FROZEN);
  });
});
