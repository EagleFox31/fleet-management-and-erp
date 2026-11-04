import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// L'image runtime installe `npm ci --omit=dev`. esbuild (--packages=external) laisse chaque import
// de paquet du serveur en import statique dans dist/index.js : un paquet absent de `dependencies`
// fait échouer le démarrage en production. vite n'est chargé que par import dynamique (server/vite.ts).
const root = path.resolve(__dirname, "../../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const deps = new Set(Object.keys(pkg.dependencies ?? {}));

const sources = execFileSync("git", ["ls-files", "server", "shared"], { cwd: root, encoding: "utf-8" })
  .split(/\r?\n/)
  .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("server/_archive/"));

const packageOf = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

/** Paquets importés statiquement (hors `import type`) et absents de `dependencies`. */
export function staticNonRuntimeImports(content: string, runtime: Set<string>): string[] {
  const found: string[] = [];
  for (const m of content.matchAll(/^import\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gms)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("@shared") || spec.startsWith("node:")) continue;
    const name = packageOf(spec);
    if (builtinModules.includes(name) || runtime.has(name)) continue;
    found.push(spec);
  }
  return found;
}

describe("serveur : imports statiques couverts par dependencies (image --omit=dev)", () => {
  it("l'image runtime installe sans les dépendances de développement", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf-8");
    expect(dockerfile.slice(dockerfile.indexOf("AS runtime"))).toMatch(/npm ci --omit=dev/);
  });

  it.each(sources)("%s", (file) => {
    expect(staticNonRuntimeImports(readFileSync(path.join(root, file), "utf-8"), deps)).toEqual([]);
  });

  it("le garde détecte un import de dépendance de développement et ignore les imports de type", () => {
    const runtime = new Set(["express"]);
    const src = 'import express from "express";\nimport { createServer } from "vite";\nimport type { X } from "vite";\nimport fs from "fs";\nimport { a } from "./a";';
    expect(staticNonRuntimeImports(src, runtime)).toEqual(["vite"]);
  });
});
