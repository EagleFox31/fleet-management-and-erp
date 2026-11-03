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
export const DEFAULT_PRODUCTION_MARKERS: readonly string[] = ["ep-bitter-term-ai6i3ey4"];

export function productionMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.E2E_PRODUCTION_DB_MARKERS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_PRODUCTION_MARKERS.map((m) => m.toLowerCase()), ...extra]));
}

/** Hôte d'une URL de connexion, sans `new URL` (mot de passe avec caractères spéciaux). */
export function hostOf(databaseUrl: string): string {
  const authority = databaseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  const at = authority.lastIndexOf("@");
  // Sans `user@`, l'autorité est déjà l'hôte (éventuellement suivi d'un port) : ne jamais
  // renvoyer "", sinon une URL sans identifiants passerait pour une base inconnue.
  return (at < 0 ? authority : authority.slice(at + 1)).toLowerCase();
}

/** Marqueur de production trouvé dans l'hôte de l'URL, ou `null`. */
export function matchProductionMarker(
  databaseUrl: string | undefined,
  markers: readonly string[],
): string | null {
  if (!databaseUrl) return null;
  const host = hostOf(databaseUrl);
  if (!host) return null;
  return markers.find((m) => host.includes(m.toLowerCase())) ?? null;
}

/** `DATABASE_URL` d'un contenu de fichier `.env` (valeur éventuellement entre guillemets). */
export function databaseUrlFromDotenv(content: string): string | undefined {
  const line = content.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
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
 * Même refus pour vitest intégration et contrat : `setup-db.ts` redirige `DATABASE_URL` vers
 * `DATABASE_URL_TEST`, et ces suites écrivent. L'URL effective ne doit pas viser la production.
 */
export function assertTestDatabaseNotProduction(
  testUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const marker = matchProductionMarker(testUrl, productionMarkers(env));
  if (!marker) return;
  throw new Error(
    [
      `Tests d'intégration et de contrat refusés : DATABASE_URL_TEST vise la base de production (hôte contenant « ${marker} »).`,
      "Ces suites créent et suppriment des données : jamais sur la production.",
      "Pointez DATABASE_URL_TEST vers une branche Neon de test, en variable d'environnement au lancement",
      "(sans modifier .env), puis relancez.",
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
 * Les messages ne contiennent que l'hôte, jamais l'URL ni le mot de passe.
 */

const NEON_SUFFIX = "neon.tech";

export function forbiddenHostMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.TEST_DB_FORBIDDEN_HOSTS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...productionMarkers(env), ...extra]));
}

/** Hôte (sans port) d'une URL, ou `""`. */
function hostnameOf(url: string): string {
  return hostOf(url).replace(/:\d+$/, "");
}

function explicitMarker(url: string, env: NodeJS.ProcessEnv): string | null {
  const host = hostOf(url);
  return forbiddenHostMarkers(env).find((m) => host.includes(m)) ?? null;
}

function isNeonHost(url: string): boolean {
  const host = hostnameOf(url);
  return host === NEON_SUFFIX || host.endsWith(`.${NEON_SUFFIX}`);
}

/** Renvoie l'URL de test effective, ou lève une erreur actionnable. */
export function assertSafeTestDatabase(env: NodeJS.ProcessEnv = process.env): string {
  const testUrl = env.DATABASE_URL_TEST;
  const baseUrl = env.DATABASE_URL;

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

  if (baseUrl && baseUrl !== testUrl) {
    throw new Error(
      [
        `Tests refusés : DATABASE_URL (hôte « ${hostOf(baseUrl)} ») diffère de DATABASE_URL_TEST (hôte « ${hostOf(testUrl)} »).`,
        "Un DATABASE_URL présent pendant les tests est le signe d'un .env de production chargé dans le runner",
        "(--env-file=.env, export dans le shell). Ne le chargez pas : retirez-le de l'environnement",
        "(unset DATABASE_URL) ou alignez-le sur DATABASE_URL_TEST, puis relancez.",
      ].join("\n"),
    );
  }

  for (const name of ["DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"] as const) {
    const other = env[name];
    if (other && other !== testUrl) {
      throw new Error(
        [
          `Tests refusés : ${name} (hôte « ${hostOf(other)} ») diffère de DATABASE_URL_TEST (hôte « ${hostOf(testUrl)} »).`,
          "server/db.ts lui donne la priorité sur DATABASE_URL pour la connexion d'écoute : il contournerait la base de test.",
          `Retirez-le de l'environnement (unset ${name}) ou alignez-le sur DATABASE_URL_TEST.`,
        ].join("\n"),
      );
    }
  }

  const marker = explicitMarker(testUrl, env);
  if (marker) {
    throw new Error(
      [
        `Tests refusés : la base de test vise un hôte interdit (hôte « ${hostOf(testUrl)} », marqueur « ${marker} »).`,
        "Pointez DATABASE_URL_TEST vers le Postgres local ou une base dédiée aux tests.",
        "Marqueurs : TEST_DB_FORBIDDEN_HOSTS, E2E_PRODUCTION_DB_MARKERS (voir tests/README.md).",
      ].join("\n"),
    );
  }

  if (isNeonHost(testUrl) && env.ALLOW_NEON_TEST_DB !== "1") {
    throw new Error(
      [
        `Tests refusés : DATABASE_URL_TEST vise un hôte ${NEON_SUFFIX} (hôte « ${hostOf(testUrl)} »).`,
        "Neon est réservé aux e2e. Utilisez le Postgres local (npm run test:db:up).",
        "Pour une branche Neon dédiée aux tests, définissez explicitement ALLOW_NEON_TEST_DB=1.",
      ].join("\n"),
    );
  }

  return testUrl;
}

/** Unitaires : refuse un DATABASE_URL exporté qui porte un marqueur de production. */
export function assertUnitDatabaseNotProduction(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.DATABASE_URL;
  if (!url) return;
  const marker = explicitMarker(url, env);
  if (!marker) return;
  throw new Error(
    [
      `Tests unitaires refusés : DATABASE_URL vise un hôte interdit (hôte « ${hostOf(url)} », marqueur « ${marker} »).`,
      "Les unitaires n'ont pas besoin de base : lancez-les sans charger le .env (unset DATABASE_URL).",
    ].join("\n"),
  );
}
