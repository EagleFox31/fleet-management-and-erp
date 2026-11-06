/**
 * Options communes des pools Postgres (`server/db.ts`).
 *
 * Plafond de connexion : sans lui, le driver attend sans limite un pair qui accepte la socket puis
 * se tait (relais réseau bloqué, proxy saturé). Une connexion lui était suspendue jusqu'à ce qu'un
 * tiers coupe : 30 s par le relais de ports de Docker Desktop, rien du tout ailleurs. Le plafond rend
 * l'échec rapide ; l'appelant décide quoi en faire (la garde de connexion répond 503, fermée sur panne).
 *
 * Il borne aussi, par construction de pg-pool, l'attente d'une place libre quand le pool est plein.
 */
export const DEFAULT_DB_CONNECT_TIMEOUT_MS = 10_000;

/** Plus grand délai que `setTimeout` respecte ; au-delà, Node le ramène à 1 ms (tout échouerait). */
export const MAX_DB_CONNECT_TIMEOUT_MS = 2 ** 31 - 1;

export type DbEnv = Readonly<Record<string, string | undefined>>;

/**
 * `DATABASE_CONNECT_TIMEOUT_MS` : entier de 0 à 2^31 - 1, en millisecondes ; 0 = sans plafond.
 * Absente ou vide : défaut. Toute autre valeur arrête le démarrage plutôt que d'être ignorée.
 */
export function dbConnectTimeoutMs(env: DbEnv = process.env): number {
  const raw = env.DATABASE_CONNECT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_DB_CONNECT_TIMEOUT_MS;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value <= MAX_DB_CONNECT_TIMEOUT_MS)) {
    throw new Error(
      `DATABASE_CONNECT_TIMEOUT_MS invalide (« ${raw} ») : entier en millisecondes de 0 à ${MAX_DB_CONNECT_TIMEOUT_MS} attendu, 0 pour aucun plafond.`,
    );
  }
  return value;
}

export function dbPoolOptions(connectionString: string, env: DbEnv = process.env) {
  return { connectionString, connectionTimeoutMillis: dbConnectTimeoutMs(env) };
}
