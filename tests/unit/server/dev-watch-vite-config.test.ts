import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Régression #252 : en dev, `server/vite.ts` charge vite.config.ts par `loadConfigFromFile`.
 * Vite 5 écrit alors `vite.config.ts.timestamp-<n>-<hash>.mjs` à la racine, l'importe puis le
 * supprime. tsx watch suit ce fichier importé : sa suppression relançait le serveur toutes les
 * ~10 s (npm run dev en boucle, serveur e2e de Playwright jamais prêt). Tout script `tsx watch`
 * doit exclure ce fichier.
 */
const root = path.resolve(__dirname, "../../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as { scripts: Record<string, string> };
const VITE_TEMP = "vite.config.ts.timestamp-1793789638877-cc2ce1088e8648.mjs";

/** Globs passés à `--exclude` / `--ignore` (forme `--exclude x`, `--exclude=x`, guillemets ou non). */
export function watchExcludes(script: string): string[] {
  return [...script.matchAll(/--(?:exclude|ignore)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Glob simple (`*`, `**`) appliqué au nom de fichier relatif à la racine. */
export function globMatches(glob: string, file: string): boolean {
  const pattern = glob
    .replace(/^\.\//, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${pattern}$`).test(file);
}

export function watchScriptsMissingViteExclude(scripts: Record<string, string>): string[] {
  return Object.entries(scripts)
    .filter(([, cmd]) => /\btsx\s+watch\b/.test(cmd))
    .filter(([, cmd]) => !watchExcludes(cmd).some((g) => globMatches(g, VITE_TEMP)))
    .map(([name]) => name);
}

describe("npm run dev : tsx watch ignore le fichier temporaire de vite.config (#252)", () => {
  it("server/vite.ts charge bien la config par loadConfigFromFile (sinon ce garde est sans objet)", () => {
    expect(readFileSync(path.join(root, "server/vite.ts"), "utf-8")).toMatch(/loadConfigFromFile\(/);
  });

  it("le script dev existe et lance tsx watch", () => {
    expect(pkg.scripts.dev).toMatch(/\btsx\s+watch\b/);
  });

  it("tout script tsx watch exclut vite.config.ts.timestamp-*.mjs", () => {
    expect(watchScriptsMissingViteExclude(pkg.scripts)).toEqual([]);
  });

  it("le garde signale un script sans exclusion ou avec une exclusion qui ne couvre pas le fichier", () => {
    expect(
      watchScriptsMissingViteExclude({
        none: "cross-env NODE_ENV=development tsx watch --env-file=.env server/index.ts",
        other: 'tsx watch --exclude "dist/**" server/index.ts',
        ok: 'tsx watch --exclude "*.timestamp-*.mjs" server/index.ts',
        okEq: "tsx watch --exclude=vite.config.ts.timestamp-* server/index.ts",
        build: "tsx scripts/build.ts",
      }),
    ).toEqual(["none", "other"]);
  });
});
