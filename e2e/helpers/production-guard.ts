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
  return at < 0 ? "" : authority.slice(at + 1).toLowerCase();
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
