/**
 * Détecteur des attentes à délai fixe dans les tests de concurrence (leçon #549).
 *
 * Un test qui tient un verrou en base puis attend N ms avant d'affirmer « l'autre écriture attend »
 * est probabiliste : sur une machine lente, l'écriture n'a pas encore atteint le verrou et le test
 * passe sans rien prouver ; sur une machine rapide, rien ne change. La preuve fiable est d'attendre
 * que Postgres voie la requête bloquée : `pg_stat_activity` avec `wait_event_type = 'Lock'`, ou
 * `pg_blocking_pids`.
 */

/** Le fichier tient lui-même un verrou en base (ligne, consultatif ou table). */
export const TAKES_DB_LOCK = /\.for\(\s*["'`]update|FOR UPDATE|pg_advisory|pg_try_advisory|LOCK TABLE/i;

/** Preuve lue dans Postgres : requête en attente de verrou, ou sondage de disponibilité du verrou. */
const LOCK_WAIT_PROBE = /pg_stat_activity|pg_blocking_pids|pg_try_advisory/;

/** Lignes examinées autour de l'attente pour trouver une sonde (boucle de sondage avant ou après). */
const PROBE_WINDOW = 8;

/** Lignes examinées après l'attente pour trouver l'assertion qu'elle prépare. */
const ASSERTION_WINDOW = 3;

/** Noms des fonctions locales de type `sleep` : `const x = (…) => new Promise((r) => setTimeout(r, …))`. */
function sleepHelpers(source: string): string[] {
  const helper = /(?:const|function)\s+(\w+)\s*=?\s*(?:\([^)]*\)\s*(?::[^=]+)?=>\s*)?new Promise\([^)]*\)\s*=>\s*setTimeout/g;
  return [...source.matchAll(helper)].map((match) => match[1]);
}

/**
 * Attentes à délai fixe suivies d'une assertion, sans sonde de verrou à proximité, dans un fichier qui
 * tient un verrou. Numérotées `${key}#n` dans l'ordre du fichier.
 */
export function findFixedWaitsBeforeLockAssertion(source: string, key: string): string[] {
  if (!TAKES_DB_LOCK.test(source)) return [];
  const helpers = sleepHelpers(source);
  const definesHelper = (line: string) => helpers.some((name) => new RegExp(`(?:const|function)\\s+${name}\\b`).test(line));
  const callsHelper = (line: string) => helpers.some((name) => new RegExp(`await\\s+${name}\\(`).test(line));
  const lines = source.split(/\r?\n/);
  const found: string[] = [];
  let ordinal = 0;
  lines.forEach((line, index) => {
    if (definesHelper(line)) return;
    const fixedWait = /setTimeout\(\s*\w+\s*,\s*[\d_]+\s*\)/.test(line) || callsHelper(line);
    if (!fixedWait) return;
    const next = lines.slice(index + 1, index + 1 + ASSERTION_WINDOW).join("\n");
    if (!/\bexpect\(/.test(next)) return;
    const around = lines.slice(Math.max(0, index - PROBE_WINDOW), index + 1 + PROBE_WINDOW).join("\n");
    if (LOCK_WAIT_PROBE.test(around)) return;
    found.push(`${key}#${++ordinal}`);
  });
  return found;
}
