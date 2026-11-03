import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

/**
 * Parcours partagé du dépôt pour les tests d'hygiène (marqueurs de conflit,
 * libellés, toasts…).
 *
 * - Liste : une seule invocation `git ls-files` par worker (fichiers suivis +
 *   non suivis non ignorés). `node_modules`, `dist`, jonctions de worktree et
 *   tout ce que `.gitignore` exclut ne sont jamais parcourus, sans `statSync`
 *   par entrée.
 * - Lecture : asynchrone, en parallèle, mémorisée par chemin. Deux tests d'un
 *   même fichier qui lisent les mêmes sources ne les relisent pas.
 */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Timeout des tests qui lisent une partie du dépôt. Leur coût est de l'I/O
 * proportionnelle à la taille du dépôt, pas de la logique : sous charge
 * (suite complète en parallèle, antivirus Windows, autres sessions), une lecture
 * de ~700 à ~1 800 fichiers a dépassé le défaut de 5 s de Vitest (jusqu'à 11 s
 * mesurés le 3 novembre 2026). 60 s laisse une marge d'un ordre de grandeur sans
 * masquer une boucle infinie.
 */
export const REPO_SCAN_TIMEOUT_MS = 60_000;

let listing: string[] | undefined;

function allFiles(): string[] {
  if (!listing) {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    // --cached liste aussi un fichier supprimé mais pas encore commité.
    listing = [...new Set(out.split("\0").filter(Boolean))].filter((f) => existsSync(join(REPO_ROOT, f)));
  }
  return listing;
}

export type RepoFileFilter = {
  /** Dossiers racines, relatifs au dépôt (`client/src`, `e2e`…). Absent : tout le dépôt. */
  under?: string[];
  /** Motif sur le chemin relatif (séparateur `/`). */
  match?: RegExp;
  /** Segments de chemin à écarter (`_archive`…). */
  skipSegments?: string[];
};

/** Chemins relatifs au dépôt, séparateur `/`, triés. */
export function repoFiles(filter: RepoFileFilter = {}): string[] {
  const under = filter.under?.map((d) => d.replace(/\\/g, "/").replace(/\/?$/, "/"));
  return allFiles()
    .filter((f) => !under || under.some((d) => f.startsWith(d)))
    .filter((f) => !filter.match || filter.match.test(f))
    .filter((f) => !filter.skipSegments?.some((s) => f.split("/").includes(s)))
    .sort();
}

const contents = new Map<string, Promise<string>>();

/** Contenu d'un fichier du dépôt (chemin relatif), lu une seule fois par worker. */
export function readRepoFile(path: string): Promise<string> {
  const key = path.replace(/\\/g, "/");
  let pending = contents.get(key);
  if (!pending) {
    pending = readFile(join(REPO_ROOT, key), "utf8");
    contents.set(key, pending);
  }
  return pending;
}

/** Lit des fichiers en parallèle ; renvoie [chemin, contenu] dans l'ordre donné. */
export async function readRepoFiles(paths: string[]): Promise<Array<[string, string]>> {
  const texts = await Promise.all(paths.map((p) => readRepoFile(p)));
  return paths.map((p, i) => [p, texts[i]]);
}
