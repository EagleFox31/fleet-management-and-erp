/**
 * Cliquet du typecheck des tests : `tsc -p tsconfig.tests.json` remonte des erreurs déjà
 * présentes dans tests/ et e2e/. Elles sont figées par fichier dans
 * `tests/typecheck-baseline.json` ; toute erreur dans un fichier absent de la base, ou au-delà
 * de son compte figé, fait échouer la vérification. Une base ne remonte jamais.
 */

const ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+:/;

/** Compte les erreurs `tsc --pretty false` par fichier (chemins normalisés en `/`). */
export function countErrorsByFile(tscOutput) {
  const counts = {};
  for (const line of tscOutput.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(line);
    if (!match) continue;
    const file = match[1].replace(/\\/g, "/");
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compare les erreurs courantes à la base figée.
 * - `regressions` : fichier hors base, ou plus d'erreurs que figé → échec ;
 * - `improvements` : moins d'erreurs que figé → la base doit être abaissée (`--update`).
 */
export function compareToBaseline(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) regressions.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = current[file] ?? 0;
    if (count < allowed) improvements.push({ file, count, allowed });
  }
  const byFile = (a, b) => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(byFile), improvements: improvements.sort(byFile) };
}

/**
 * Garde anti-relèvement : la base versionnée comparée à celle de la branche de référence
 * (la cible de la PR). Une entrée nouvelle ou un compte plus haut est un relèvement à la main,
 * refusé ; une baisse ou une égalité passe. Renvoie les entrées relevées.
 */
export function raisedEntries(baseline, reference) {
  return compareToBaseline(baseline, reference).regressions;
}

/**
 * Branche de référence de la garde, sans supposer `main` :
 * `TESTS_BASELINE_REF` explicite, sinon la cible de la PR (`GITHUB_BASE_REF`), sinon la branche
 * par défaut du dépôt distant (`originHead`, lu par `git symbolic-ref`). `null` si rien n'est connu.
 */
export function resolveReferenceRef(env, originHead) {
  if (env.TESTS_BASELINE_REF) return env.TESTS_BASELINE_REF;
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  return originHead || null;
}

/** Base à écrire après `--update` : jamais au-dessus de l'ancienne, fichiers corrigés retirés. */
export function lowerBaseline(current, baseline) {
  const next = {};
  for (const file of Object.keys(baseline).sort()) {
    const count = Math.min(current[file] ?? 0, baseline[file]);
    if (count > 0) next[file] = count;
  }
  return next;
}
