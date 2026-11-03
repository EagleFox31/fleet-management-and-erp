import { assertSafeTestDatabase } from "../../e2e/helpers/production-guard";
import { acquireTestDbLock, lockTimeoutFromEnv } from "./test-db-lock";

/**
 * globalSetup des suites intégration et contrat : prend le verrou de la base de test pour tout le
 * passage et le rend au globalTeardown (voir `test-db-lock.ts`). La garde de production passe avant
 * toute connexion.
 */
export default async function setup() {
  const connectionString = assertSafeTestDatabase();
  const lock = await acquireTestDbLock({
    connectionString,
    timeoutMs: lockTimeoutFromEnv(),
    log: (message) => console.warn(`[verrou base de test] ${message}`),
  });
  return async () => {
    await lock.release();
  };
}
