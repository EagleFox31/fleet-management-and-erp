import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Garde-fou : un e2e écrit (utilisateurs, factures, pièces, OT) sur la base pointée
 * par `DATABASE_URL`. Il ne doit jamais démarrer contre la production.
 *
 * Une base est « production » quand son hôte contient l'un des marqueurs :
 *  - `DEFAULT_PRODUCTION_MARKERS` (endpoint Neon de production connu) ;
 *  - ceux de `E2E_PRODUCTION_DB_MARKERS` (liste séparée par des virgules), pour un
 *    autre environnement ou un autre fournisseur, sans toucher au code.
 *
 * Le message d'erreur ne reproduit jamais l'URL (mot de passe) : seulement le marqueur.
 */
import {
  DEFAULT_PRODUCTION_MARKERS,
  hostOf,
  matchProductionMarker,
  productionMarkers,
} from "../../shared/production-database";

// Reconnaissance des marqueurs : source unique partagée avec le serveur (shared/production-database.ts).
export { DEFAULT_PRODUCTION_MARKERS, hostOf, matchProductionMarker, productionMarkers };

/**
 * `DATABASE_URL` d'un contenu de fichier `.env` (valeur éventuellement entre guillemets).
 * Une clé en double est refusée : `node --env-file` garde la dernière, ce lecteur lisait la
 * première, et l'ordre des lignes décidait seul de la base visée (near miss du 4 novembre 2026).
 */
export function databaseUrlFromDotenv(content: string): string | undefined {
  const lines = content.split(/\r?\n/).filter((l) => /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l));
  if (lines.length > 1) {
    throw new Error(
      [
        `Le .env définit DATABASE_URL ${lines.length} fois : node --env-file garde la dernière, l'ordre des lignes décide de la base visée.`,
        "Ne gardez qu'une ligne DATABASE_URL (supprimez les autres), puis relancez.",
      ].join("\n"),
    );
  }
  const line = lines[0];
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  return value || undefined;
}

/**
 * Base réellement visée : la variable d'environnement d'abord (elle prime sur `--env-file`),
 * à défaut le `.env` du répertoire courant que le serveur lancé par Playwright chargerait.
 */
export function resolveTargetDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  readDotenv: () => string | undefined = () => {
    const file = resolve(process.cwd(), ".env");
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  },
): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const content = readDotenv();
  return content ? databaseUrlFromDotenv(content) : undefined;
}

export function assertNotProductionDatabase(
  env: NodeJS.ProcessEnv = process.env,
  readDotenv?: () => string | undefined,
): void {
  const marker = matchProductionMarker(resolveTargetDatabaseUrl(env, readDotenv), productionMarkers(env));
  if (!marker) return;
  throw new Error(
    [
      `Les e2e refusent de démarrer : DATABASE_URL vise la base de production (hôte contenant « ${marker} »).`,
      "Les specs créent et suppriment des utilisateurs, factures, pièces et OT : jamais sur la production.",
      "Pointez DATABASE_URL (et DATABASE_URL_TEST) vers une branche Neon de test, en variable d'environnement",
      "au lancement (sans modifier .env), puis relancez :",
      "  DATABASE_URL=<url de test> node node_modules/@playwright/test/cli.js test",
      "Autre environnement protégé : ajoutez son hôte à E2E_PRODUCTION_DB_MARKERS (liste séparée par des virgules).",
    ].join("\n"),
  );
}

/**
 * Garde-fou des suites vitest (intégration, contrat, unitaires), en complément de
 * `assertNotProductionDatabase` (e2e). Voir tests/README.md.
 *
 * `assertSafeTestDatabase` refuse de démarrer quand :
 *  (a) `DATABASE_URL`, `DATABASE_URL_LISTENER` ou `DATABASE_URL_DIRECT` est défini et
 *      diffère de `DATABASE_URL_TEST` (typiquement un `.env` de production chargé) ;
 *  (b) `DATABASE_URL_TEST` manque : aucun repli sur `DATABASE_URL` ;
 *  (c) l'hôte effectif est interdit : marqueur de `TEST_DB_FORBIDDEN_HOSTS` (virgules),
 *      marqueurs ci-dessus, ou tout hôte `*.neon.tech` sauf `ALLOW_NEON_TEST_DB=1`.
 *      `ALLOW_NEON_TEST_DB` ne lève jamais un marqueur explicite.
 * `assertUnitDatabaseNotProduction` : pas de base requise, mais refuse un `DATABASE_URL`
 * exporté qui porte un marqueur (server/db.ts construirait un pool dessus).
 * Les messages ne contiennent que l'hôte (`safeHostLabel`), jamais l'URL ni le mot de passe ;
 * une URL illisible est refusée (on ne sait pas quel hôte elle vise).
 */

const NEON_SUFFIX = "neon.tech";
const UNREADABLE_HOST = "hôte illisible";
const SIBLING_URLS = ["DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"] as const;
const POWERSHELL_UNSET = "Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue";

export function forbiddenHostMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.TEST_DB_FORBIDDEN_HOSTS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...productionMarkers(env), ...extra]));
}

/** Hôte lisible par `new URL`, ou `null` (URL invalide : `#` ou `/` dans un mot de passe non encodé). */
function parsedHost(url: string): { hostname: string; port: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname || /[:@]/.test(u.hostname)) return null;
    // Un « @ » dans l'URL alors que new URL n'a trouvé aucun identifiant : le mot de passe contient
    // un `#` ou un `/` non encodé et l'« hôte » lu est un morceau d'identifiant.
    if (!u.username && !u.password && url.includes("@")) return null;
    return { hostname: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

/** Libellé d'hôte pour un message : jamais d'identifiant, « hôte illisible » au moindre doute. */
export function safeHostLabel(url: string): string {
  const h = parsedHost(url);
  return h ? (h.port ? `${h.hostname}:${h.port}` : h.hostname) : UNREADABLE_HOST;
}

function explicitMarker(url: string, env: NodeJS.ProcessEnv): string | null {
  const host = parsedHost(url)?.hostname ?? "";
  return forbiddenHostMarkers(env).find((m) => host.includes(m)) ?? null;
}

function isNeonHost(url: string): boolean {
  const host = parsedHost(url)?.hostname ?? "";
  return host === NEON_SUFFIX || host.endsWith(`.${NEON_SUFFIX}`);
}

function assertHostAllowed(subject: string, url: string, env: NodeJS.ProcessEnv): void {
  if (!parsedHost(url)) {
    throw new Error(
      [
        `Tests refusés : ${subject} n'est pas une URL lisible (${UNREADABLE_HOST}) : l'hôte visé ne peut pas être vérifié.`,
        "Encodez en pourcentage les caractères spéciaux du mot de passe (# / @ ?) ou utilisez le Postgres local.",
      ].join("\n"),
    );
  }
  const marker = explicitMarker(url, env);
  if (marker) {
    throw new Error(
      [
        `Tests refusés : ${subject} vise un hôte interdit (hôte « ${safeHostLabel(url)} », marqueur « ${marker} »).`,
        "Pointez DATABASE_URL_TEST vers le Postgres local ou une base dédiée aux tests.",
        "Marqueurs : TEST_DB_FORBIDDEN_HOSTS, E2E_PRODUCTION_DB_MARKERS (voir tests/README.md).",
      ].join("\n"),
    );
  }
  if (isNeonHost(url) && env.ALLOW_NEON_TEST_DB !== "1") {
    throw new Error(
      [
        `Tests refusés : ${subject} vise un hôte ${NEON_SUFFIX} (hôte « ${safeHostLabel(url)} »).`,
        "Neon est réservé aux e2e. Utilisez le Postgres local (npm run test:db:up).",
        "Pour une branche Neon dédiée aux tests, définissez explicitement ALLOW_NEON_TEST_DB=1.",
      ].join("\n"),
    );
  }
}

/** Renvoie l'URL de test effective, ou lève une erreur actionnable. */
export function assertSafeTestDatabase(env: NodeJS.ProcessEnv = process.env): string {
  const testUrl = env.DATABASE_URL_TEST;

  if (!testUrl) {
    throw new Error(
      [
        "Tests refusés : DATABASE_URL_TEST est requis pour les suites d'intégration et de contrat.",
        "Il n'y a volontairement aucun repli sur DATABASE_URL (base de développement ou de production).",
        "Lancez par exemple : DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test DATABASE_WS_PROXY=localhost:5433/v1 npm run test:contract",
        "Voir tests/README.md, section « Postgres local ».",
      ].join("\n"),
    );
  }

  for (const name of ["DATABASE_URL", ...SIBLING_URLS] as const) {
    const other = env[name];
    if (other && other !== testUrl) {
      const powershell = name === "DATABASE_URL" ? POWERSHELL_UNSET : `Remove-Item Env:${name} -ErrorAction SilentlyContinue`;
      throw new Error(
        [
          `Tests refusés : ${name} (${safeHostLabel(other)}) diffère de DATABASE_URL_TEST (${safeHostLabel(testUrl)}).`,
          "Une telle variable pendant les tests est le signe d'un .env de production chargé dans le runner",
          "(--env-file=.env, export dans le shell). Ne le chargez pas : retirez-la de l'environnement",
          `(bash : unset ${name} ; PowerShell : ${powershell}) ou alignez-la sur DATABASE_URL_TEST, puis relancez.`,
        ].join("\n"),
      );
    }
  }

  assertHostAllowed("DATABASE_URL_TEST", testUrl, env);
  return testUrl;
}

/**
 * Unitaires : pas de base requise. Refuse un `DATABASE_URL` / `_LISTENER` / `_DIRECT` exporté qui
 * porte un marqueur interdit ou un hôte `*.neon.tech` (sauf ALLOW_NEON_TEST_DB=1). Un placeholder
 * local (127.0.0.1:1) passe.
 */
export function assertUnitDatabaseNotProduction(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of ["DATABASE_URL", ...SIBLING_URLS] as const) {
    const url = env[name];
    if (url) assertHostAllowed(name, url, env);
  }
}
