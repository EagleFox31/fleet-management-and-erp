import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { build, type Metafile } from "esbuild";
import { describe, expect, it } from "vitest";

// L'image runtime installe `npm ci --omit=dev`. Le garde rejoue le bundle serveur de `npm run build`
// (esbuild --packages=external) et lit son metafile : chaque paquet externe de dist/index.js
// (import, export … from, import() ou require) doit figurer dans `dependencies`, sinon le démarrage
// échoue en production. Seule exception : vite, chargé par import dynamique en mode dev (server/vite.ts).
const root = path.resolve(__dirname, "../../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const deps = new Set<string>(Object.keys(pkg.dependencies ?? {}));
/** Import dynamique de paquet hors `dependencies` toléré, par fichier source (chemin du metafile). */
const DYNAMIC_DEV_ALLOWLIST: Record<string, string[]> = { "server/vite.ts": ["vite"] };

const packageOf = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

async function bundle(options: Parameters<typeof build>[0]): Promise<Metafile> {
  const result = await build({
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
    outdir: "out",
    ...options,
  });
  return result.metafile!;
}

/**
 * Paquets externes réellement importés par le bundle (metafile.outputs : les imports de type,
 * élidés, n'y sont pas) et absents de `dependencies`. Un import() dynamique est toléré seulement
 * si tous les fichiers sources qui le portent (metafile.inputs) sont dans la liste blanche.
 */
export function nonRuntimeImports(
  metafile: Metafile,
  runtime: Set<string>,
  allowlist: Record<string, string[]> = DYNAMIC_DEV_ALLOWLIST,
): string[] {
  const dynamicFrom = (name: string) =>
    Object.entries(metafile.inputs)
      .filter(([, input]) => input.imports.some((i) => i.kind === "dynamic-import" && packageOf(i.path) === name))
      .map(([file]) => file);
  const found = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const imp of output.imports) {
      if (!imp.external || imp.path.startsWith("node:")) continue;
      const name = packageOf(imp.path);
      if (builtinModules.includes(name) || runtime.has(name)) continue;
      if (imp.kind === "dynamic-import") {
        const files = dynamicFrom(name);
        if (files.length > 0 && files.every((f) => allowlist[f]?.includes(name))) continue;
      }
      found.add(`${imp.path} (${imp.kind})`);
    }
  }
  return [...found].sort();
}

describe("bundle serveur : paquets externes couverts par dependencies (image --omit=dev)", () => {
  it("l'image runtime installe sans les dépendances de développement", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf-8");
    expect(dockerfile.slice(dockerfile.indexOf("AS runtime"))).toMatch(/npm ci --omit=dev/);
  });

  it("dist/index.js n'importe aucun paquet de développement", async () => {
    const metafile = await bundle({ entryPoints: [path.join(root, "server/index.ts")], absWorkingDir: root });
    expect(nonRuntimeImports(metafile, deps)).toEqual([]);
  }, 60_000);

  it("le garde voit import statique, export … from, import() et require, et ne tolère vite en dynamique que dans le fichier autorisé", async () => {
    const metafile = await bundle({
      stdin: {
        contents: [
          'import express from "express";',
          'export { defineConfig } from "vite";',
          'export * from "tsx";',
          'export const t = () => import("vitest");',
          'export const v = () => import("vite");',
          'export const e = () => require("esbuild");',
          'import type { X } from "msw";',
          'import { Y } from "drizzle-kit"; export type Z = Y;',
        ].join("\n"),
        loader: "ts",
        resolveDir: root,
      },
    });
    expect(nonRuntimeImports(metafile, new Set(["express"]), { "<stdin>": ["vite"] })).toEqual([
      "esbuild (require-call)",
      "tsx (import-statement)",
      "vite (import-statement)",
      "vitest (dynamic-import)",
    ]);
    // Hors du fichier autorisé, import("vite") est refusé.
    expect(nonRuntimeImports(metafile, new Set(["express"]), {})).toContain("vite (dynamic-import)");
  });
});
