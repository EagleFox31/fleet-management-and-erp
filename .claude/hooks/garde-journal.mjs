#!/usr/bin/env node
// Stop (devient SubagentStop dans un agent) : un agent qui livre du code ne s'arrête pas
// tant qu'un de ses commits n'a pas son entrée de journal dans le même commit.
// Règle : docs/adr/0001-lot-recette-2026-11-02.md §13, docs/journal/README.md.
// Code de sortie 2 = l'agent continue, stderr lui sert de consigne.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const JOURNAUX = [/^docs\/journal\//, /^docs\/qa\/JOURNAL_COUVERTURE\.md$/];
// Un commit qui ne touche que des journaux ou des ADR n'exige pas d'entrée de journal supplémentaire.
const DOCS_SEULES = [/^docs\/journal\//, /^docs\/adr\//, /^docs\/qa\/JOURNAL_COUVERTURE\.md$/];

export function commitsSansJournal(commits) {
  return commits
    .filter(({ fichiers }) => fichiers.length > 0)
    .filter(({ fichiers }) => !fichiers.every((f) => DOCS_SEULES.some((m) => m.test(f))))
    .filter(({ fichiers }) => !fichiers.some((f) => JOURNAUX.some((m) => m.test(f))))
    .map(({ hash, sujet }) => ({ hash, sujet }));
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function baseParDefaut(cwd) {
  try {
    return git(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  } catch {
    return null;
  }
}

export function lireCommits(cwd, base) {
  const hashes = git(cwd, "rev-list", "--no-merges", `${base}..HEAD`).split("\n").filter(Boolean);
  return hashes.map((hash) => ({
    hash: hash.slice(0, 7),
    sujet: git(cwd, "log", "-1", "--format=%s", hash),
    fichiers: git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", hash).split("\n").filter(Boolean),
  }));
}

async function main() {
  let brut = "";
  for await (const morceau of process.stdin) brut += morceau;
  let input = {};
  try {
    input = JSON.parse(brut);
  } catch {
    process.stderr.write("garde-journal : entrée illisible, journal non contrôlé.\n");
    process.exit(0);
  }
  // Évite la boucle : si l'agent repart déjà à cause de ce garde, on le laisse finir.
  if (input.stop_hook_active) process.exit(0);
  const cwd = input.cwd || process.cwd();
  const base = baseParDefaut(cwd);
  if (!base) {
    process.stderr.write("garde-journal : branche par défaut introuvable, journal non contrôlé.\n");
    process.exit(0);
  }
  let manquants;
  try {
    manquants = commitsSansJournal(lireCommits(cwd, base));
  } catch {
    process.stderr.write("garde-journal : historique illisible, journal non contrôlé.\n");
    process.exit(0);
  }
  if (manquants.length > 0) {
    const liste = manquants.map((c) => `${c.hash} ${c.sujet}`).join("; ");
    process.stderr.write(
      `Journal manquant dans ces commits : ${liste}. Ajoute l'entrée (docs/journal/<agent>.md, format de docs/journal/README.md) dans le même commit, puis termine.\n`,
    );
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
