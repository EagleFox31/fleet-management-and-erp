/**
 * #298 : en test, la connexion directe (`listenerPool`) vise la base de test, quoi qu'hérite
 * l'environnement. Appelé par `setup-db.ts` après le choix de DATABASE_URL.
 */
export function pinListenerUrlsToTestDatabase(env: NodeJS.ProcessEnv): void {
  const testUrl = env.DATABASE_URL;
  if (!testUrl) throw new Error("pinListenerUrlsToTestDatabase : DATABASE_URL doit être posé avant.");
  env.DATABASE_URL_LISTENER = testUrl;
  env.DATABASE_URL_DIRECT = testUrl;
}
