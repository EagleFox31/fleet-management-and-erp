#!/usr/bin/env node
/**
 * `npm run check:tests` : typecheck de tests/ et e2e/ (tsconfig.tests.json), sous cliquet.
 * `npm run check` ne couvre pas tests/ : une signature serveur durcie pouvait casser des tests
 * sans erreur de compilation, seulement à l'exécution en CI.
 *
 *   node scripts/check-tests-types.mjs            vérifie (échec sur toute erreur nouvelle)
 *   node scripts/check-tests-types.mjs --update   abaisse la base après correction
 *
 * La base versionnée est d'abord comparée à celle de la branche de référence (cible de la PR,
 * sinon branche par défaut, ou `TESTS_BASELINE_REF`) : un relèvement à la main est refusé.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  compareToBaseline,
  countErrorsByFile,
  lowerBaseline,
  raisedEntries,
  resolveReferenceRef,
} from "./lib/tests-typecheck-ratchet.mjs";

const BASELINE_PATH = "tests/typecheck-baseline.json";
const update = process.argv.includes("--update");

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
checkBaselineNotRaised(baseline);

function git(args) {
  return spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Refuse une base relevée par rapport à la référence. En CI, une référence introuvable est un
 * échec (la garde ne doit pas s'éteindre en silence) ; hors CI, un avertissement.
 */
function checkBaselineNotRaised(current) {
  const originHead = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const ref = resolveReferenceRef(process.env, originHead.status === 0 ? originHead.stdout.trim() : null);
  const unavailable = (why) => {
    if (process.env.CI === "true") {
      console.error(`Garde de la base : ${why}.`);
      console.error("Récupérer la branche de référence avant check:tests (git fetch origin <branche>), ou poser TESTS_BASELINE_REF.");
      process.exit(1);
    }
    console.warn(`Garde de la base ignorée hors CI : ${why}.`);
  };
  if (!ref) return unavailable("branche de référence inconnue");
  if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
    return unavailable(`référence ${ref} introuvable`);
  }
  const shown = git(["show", `${ref}:${BASELINE_PATH}`]);
  // Base absente de la référence : c'est son introduction, rien à comparer.
  if (shown.status !== 0) return;

  const raised = raisedEntries(current, JSON.parse(shown.stdout));
  if (raised.length === 0) return;
  console.error(`${BASELINE_PATH} est relevée par rapport à ${ref} :`);
  for (const r of raised) console.error(`  ${r.file} : ${r.count} / ${r.allowed}`);
  console.error("\nLa base ne fait que baisser : corriger l'erreur TypeScript au lieu de la figer.");
  process.exit(1);
}

const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const run = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.tests.json", "--pretty", "false"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (run.error) throw run.error;
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const current = countErrorsByFile(output);

// Une sortie en échec sans erreur localisée (config invalide, types introuvables) n'est pas
// un succès : on l'affiche telle quelle.
if (run.status !== 0 && Object.keys(current).length === 0) {
  console.error(output.trim() || `tsc a échoué (code ${run.status}) sans message.`);
  process.exit(run.status ?? 1);
}

const { regressions, improvements } = compareToBaseline(current, baseline);

if (regressions.length > 0) {
  const files = new Set(regressions.map((r) => r.file));
  console.error("Erreurs TypeScript nouvelles dans les tests :\n");
  for (const line of output.split(/\r?\n/)) {
    const file = line.split("(")[0].replace(/\\/g, "/");
    if (files.has(file)) console.error(line);
  }
  console.error("\nPar fichier (courant / figé) :");
  for (const r of regressions) console.error(`  ${r.file} : ${r.count} / ${r.allowed}`);
  console.error(`\nCorriger ces erreurs ; la base ${BASELINE_PATH} ne se relève pas.`);
  process.exit(1);
}

if (update) {
  const next = lowerBaseline(current, baseline);
  // Comparaison sur le contenu, pas le texte : une copie en CRLF n'est pas réécrite.
  if (JSON.stringify(next) === JSON.stringify(baseline)) {
    console.log(`${BASELINE_PATH} déjà à jour.`);
  } else {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${BASELINE_PATH} abaissée.`);
  }
  process.exit(0);
}

if (improvements.length > 0) {
  console.error("Des erreurs figées ont été corrigées : abaisser la base avec");
  console.error("  node scripts/check-tests-types.mjs --update");
  for (const i of improvements) console.error(`  ${i.file} : ${i.count} / ${i.allowed}`);
  process.exit(1);
}

const total = Object.values(current).reduce((sum, n) => sum + n, 0);
console.log(`Typecheck des tests : aucune erreur nouvelle (${total} figées).`);
