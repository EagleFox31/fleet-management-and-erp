import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Precache de la coquille par le service worker (V5b-3d).
 *
 * `client/public/sw.js` porte un marqueur `SHELL_MANIFEST = /*SHELL_MANIFEST* / null`. Apres chaque
 * build, ce plugin le remplace par `{ build, assets }` : l'empreinte du build et la liste de
 * tous les fichiers statiques produits par Vite. Le worker les telecharge a l'installation.
 */

export interface ShellManifest {
  /** Empreinte du build : nom du cache de coquille et version du worker. */
  build: string;
  /** URL absolues (`/assets/...`) a precacher, triees. */
  assets: string[];
}

/** Extensions de la coquille : code, styles, polices, icones et images du bundle. */
const SHELL_EXTENSIONS = /\.(js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|ico)$/i;

/**
 * Fichiers du bundle a precacher : ceux de `assets/` (a empreinte, donc immuables) qui ont une
 * extension de coquille. Les cartes de sources (.map) et le HTML sont exclus (l'index.html est
 * precache a part, par STATIC_ASSETS dans sw.js).
 */
export function shellAssetUrls(bundleFileNames: string[]): string[] {
  return bundleFileNames
    .filter((name) => name.startsWith("assets/") && SHELL_EXTENSIONS.test(name))
    .map((name) => `/${name}`)
    .sort();
}

/** Empreinte du build : liste des assets (noms a empreinte) et contenu de l'index.html. */
export function shellBuildId(assets: string[], indexHtml: string): string {
  return createHash("sha256").update(assets.join("\n")).update("\0").update(indexHtml).digest("hex").slice(0, 10);
}

export function buildShellManifest(bundleFileNames: string[], indexHtml: string): ShellManifest {
  const assets = shellAssetUrls(bundleFileNames);
  return { build: shellBuildId(assets, indexHtml), assets };
}

const PLACEHOLDER = /\/\*SHELL_MANIFEST\*\/ null/;

/** Insere le manifeste dans le source du worker. Leve une erreur si le marqueur est absent. */
export function injectShellManifest(swSource: string, manifest: ShellManifest): string {
  if (!PLACEHOLDER.test(swSource)) {
    throw new Error("sw.js : marqueur SHELL_MANIFEST introuvable (le precache ne serait pas injecte)");
  }
  return swSource.replace(PLACEHOLDER, () => JSON.stringify(manifest));
}

/** Plugin Vite : injecte le manifeste dans `sw.js` copie dans le dossier de sortie. */
export function swShellPlugin(): Plugin {
  return {
    name: "fleetos-sw-shell",
    apply: "build",
    writeBundle(options, bundle) {
      const outDir = options.dir;
      if (!outDir) return;
      const indexEntry = bundle["index.html"];
      const indexHtml =
        indexEntry && indexEntry.type === "asset" ? String(indexEntry.source) : readFileSync(path.join(outDir, "index.html"), "utf8");
      const manifest = buildShellManifest(Object.keys(bundle), indexHtml);
      if (manifest.assets.length === 0) {
        throw new Error("sw.js : aucun asset a precacher dans le bundle");
      }
      const swPath = path.join(outDir, "sw.js");
      writeFileSync(swPath, injectShellManifest(readFileSync(swPath, "utf8"), manifest));
    },
  };
}
