import { deriveDirectConnectionString } from "../../server/lib/listener-connection";

/**
 * #298 : en test, la connexion directe (`listenerPool`) vise la base de test, quoi qu'hérite
 * l'environnement, par l'hôte direct (sans `-pooler.`) : LISTEN et verrous de session ne
 * passent pas par le pooler Neon. Appelé par `setup-db.ts` après le choix de DATABASE_URL.
 */
export function pinListenerUrlsToTestDatabase(env: NodeJS.ProcessEnv): void {
  const testUrl = env.DATABASE_URL;
  if (!testUrl) throw new Error("pinListenerUrlsToTestDatabase : DATABASE_URL doit être posé avant.");
  const direct = deriveDirectConnectionString(testUrl);
  env.DATABASE_URL_LISTENER = direct;
  env.DATABASE_URL_DIRECT = direct;
}
