import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Un `cd` qui échoue ne doit jamais laisser la suite s'exécuter ailleurs.
 *
 * Incident du 5 novembre 2026 (docs/analysis/LESSONS_LEARNED.md) : une commande
 * `cd <worktree>; ...; git checkout -q -- .` a vu son `cd` échouer, et le
 * `checkout` a écrasé les modifications non commitées du dépôt principal.
 *
 * Règles, appliquées aux instructions d'agents (`.claude/agents`, `.claude/skills`,
 * `.claude/commands`), aux scripts (`*.sh`, `*.bash`, `*.ps1`, `scripts/`,
 * `deploy/`), aux workflows et à `package.json` :
 *   1. `cd <chemin>;` suivi d'une commande est interdit partout. Écrire
 *      `cd <chemin> || exit 1` ou `cd <chemin> && ...`.
 *   2. Dans un script shell sans `set -e`, une ligne `cd <chemin>` seule, non
 *      gardée par `||` ou `&&`, est interdite pour la même raison. Les workflows
 *      GitHub ne sont pas concernés : leur shell `bash` tourne avec `-e`.
 *
 * Les occurrences déjà présentes sont gelées ci-dessous (clé `fichier:ligne`) :
 * la liste ne peut que rétrécir.
 */
const KNOWN_UNGUARDED_CD: string[] = [];

/** `cd <chemin>;` puis une commande, sur la même ligne. */
const INLINE_CD_SEMICOLON = /(^|[\s;&|(`"'])cd\s+[^;&|#\n]+;\s*[^\s#]/;

/** Ligne qui n'est qu'un `cd <chemin>` sans garde. */
const BARE_CD_LINE = /^\s*cd\s+[^;&|#]+?\s*(#.*)?$/;

const ERREXIT = /^\s*set\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/m;

function findUnguardedCd(path: string, src: string): string[] {
  const isShell = /\.(sh|bash)$/.test(path);
  const hasErrexit = isShell && ERREXIT.test(src);
  const out: string[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (INLINE_CD_SEMICOLON.test(line)) out.push(`${path}:${i + 1}`);
    else if (isShell && !hasErrexit && BARE_CD_LINE.test(line)) out.push(`${path}:${i + 1}`);
  });
  return out;
}

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "worktrees", "_archive", "android", "ios"]);

function scannedFile(rel: string): boolean {
  const p = rel.replace(/\\/g, "/");
  if (/^\.claude\/(agents|skills|commands)\/.*\.md$/.test(p)) return true;
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(p)) return true;
  if (/^(scripts|deploy)\//.test(p)) return true;
  if (p === "package.json") return true;
  return /\.(sh|bash|ps1)$/.test(p);
}

function walk(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else {
      const rel = relative(rootDir, full).replace(/\\/g, "/");
      if (scannedFile(rel)) acc.push(rel);
    }
  }
  return acc;
}

describe("détecteur de cd non gardé", () => {
  it.each([
    ["x.md", "cd .claude/worktrees/aa; git checkout -q -- ."],
    ["x.md", "(cd $WT; npm test)"],
    ["x.ps1", "cd C:\\repo; git reset --hard"],
    ["x.sh", "#!/bin/bash\ncd \"$DIR\"\nrm -rf build"],
  ])("signale %s : %s", (path, src) => {
    expect(findUnguardedCd(path, src)).not.toEqual([]);
  });

  it.each([
    ["x.md", "cd .claude/worktrees/aa || exit 1; git checkout -q -- ."],
    ["x.md", "cd \"$WT\" && npm test"],
    ["x.sh", "#!/bin/bash\nset -euo pipefail\ncd \"$DIR\"\nrm -rf build"],
    ["x.yml", "        run: |\n          cd android\n          ./gradlew build"],
    ["x.md", "cd /repo # commentaire; pas une commande"],
  ])("accepte %s : %s", (path, src) => {
    expect(findUnguardedCd(path, src)).toEqual([]);
  });
});

describe("hygiène des cd chaînés", () => {
  const files = walk(rootDir, []);

  it("parcourt les instructions d'agents et les scripts", () => {
    expect(files.some((f) => f.startsWith(".claude/agents/"))).toBe(true);
    expect(files).toContain("deploy/backup-db.sh");
  });

  it("aucun cd non gardé hors liste gelée", () => {
    const found = files.flatMap((f) => findUnguardedCd(f, readFileSync(join(rootDir, f), "utf8")));
    expect(found.filter((k) => !KNOWN_UNGUARDED_CD.includes(k))).toEqual([]);
  });

  it("la liste gelée ne contient que des occurrences encore présentes", () => {
    const found = new Set(files.flatMap((f) => findUnguardedCd(f, readFileSync(join(rootDir, f), "utf8"))));
    expect(KNOWN_UNGUARDED_CD.filter((k) => !found.has(k))).toEqual([]);
  });
});
