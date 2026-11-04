import { matchProductionMarker, productionMarkers } from "@shared/production-database";
import { moduleLogger } from "./logger";

/**
 * Garde-fou hors production (serveur dev, scripts tsx, drizzle-kit, recette locale) : refuse de construire
 * un pool sur la base de production. Le 2026-11-04, `npm run dev` lancé avec `--env-file=.env`
 * (racine pointant l'ancien Neon de production) y a rejoué les migrations d'amorçage et créé
 * des alertes. Voir docs/analysis/LESSONS_LEARNED.md.
 *
 * - `NODE_ENV=production` : no-op (l'image de production vise sa propre base). Ne jamais le préfixer
 *   en local : le garde est alors contourné sans log (#268).
 * - Dérogation explicite : `ALLOW_PRODUCTION_DATABASE=1`, pour une intervention volontaire.
 * - Variables vérifiées : DATABASE_URL, DATABASE_URL_LISTENER, DATABASE_URL_DIRECT.
 * Le message ne contient que le marqueur, jamais l'URL ni le mot de passe.
 */
export const PRODUCTION_DB_OVERRIDE = "ALLOW_PRODUCTION_DATABASE";
const CHECKED_URLS = ["DATABASE_URL", "DATABASE_URL_LISTENER", "DATABASE_URL_DIRECT"] as const;

export type ProductionDbGuardResult =
  | { status: "skipped" }
  | { status: "clear" }
  | { status: "overridden"; variable: string; marker: string };

export function assertServerNotProductionDatabase(
  env: NodeJS.ProcessEnv = process.env,
): ProductionDbGuardResult {
  if (env.NODE_ENV === "production") return { status: "skipped" };
  const markers = productionMarkers(env);
  for (const variable of CHECKED_URLS) {
    const marker = matchProductionMarker(env[variable], markers);
    if (!marker) continue;
    if (env[PRODUCTION_DB_OVERRIDE] === "1") return { status: "overridden", variable, marker };
    throw new Error(
      [
        `Connexion refusée : ${variable} vise la base de production (hôte contenant « ${marker} »)`,
        `alors que NODE_ENV=${env.NODE_ENV ?? "(non défini)"}. Le serveur, un script ou drizzle-kit y écrirait`,
        "(migrations d'amorçage, tâches de fond, schéma).",
        "Pointez DATABASE_URL vers le Postgres local en variable d'environnement (elle prime sur --env-file) :",
        "  DATABASE_URL=postgres://fleet:fleet@postgres:5432/<base> DATABASE_WS_PROXY=localhost:5433/v1 npm run dev",
        "Ne préfixez pas NODE_ENV=production en local : le garde serait contourné sans trace.",
        `Intervention volontaire sur la production : ${PRODUCTION_DB_OVERRIDE}=1.`,
      ].join("\n"),
    );
  }
  return { status: "clear" };
}

/**
 * Point d'appel unique avant toute construction de pool ou de client SQL : `server/db.ts` et les
 * scripts qui ouvrent leur propre connexion (garde d'hygiène : tests/unit/server/db-pool-hygiene.test.ts).
 * Lève hors production sur une base marquée ; journalise la dérogation quand elle est utilisée.
 */
export function guardDatabaseConnection(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): ProductionDbGuardResult {
  const result = assertServerNotProductionDatabase(env);
  if (result.status === "overridden") {
    moduleLogger(source).warn(
      { variable: result.variable, marker: result.marker },
      `Connexion à la base de production hors NODE_ENV=production (${PRODUCTION_DB_OVERRIDE}=1)`,
    );
  }
  return result;
}
