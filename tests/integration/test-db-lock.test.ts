import { describe, expect, it } from "vitest";
import { acquireTestDbLock, lockTimeoutFromEnv, TEST_DB_LOCK_NAMESPACE } from "../support/test-db-lock";

/**
 * Verrou de la base de test (globalSetup des suites intégration et contrat), niveau I.
 *
 * - Le passage en cours tient le verrou réel : une seconde prise expire, en nommant le détenteur.
 * - Deux prises sur la même base s'enchaînent : la seconde attend, annonce le détenteur, puis
 *   obtient le verrou dès que la première le rend. Espace de noms propre au test, pour ne pas
 *   dépendre du verrou réel tenu par ce passage.
 */

const connectionString = process.env.DATABASE_URL_TEST!;

describe("verrou de la base de test", { timeout: 60000 }, () => {
  it("le passage en cours tient le verrou réel : une seconde prise expire avec un message actionnable", async () => {
    const attempt = acquireTestDbLock({
      connectionString,
      namespace: TEST_DB_LOCK_NAMESPACE,
      timeoutMs: 1500,
      pollMs: 300,
      owner: "test seconde prise",
      log: () => {},
    });
    await expect(attempt).rejects.toThrow(/Verrou de la base de test non obtenu .*pid \d+, fleet-test-lock /);
    await expect(attempt).rejects.toThrow(/pg_terminate_backend\(\d+\)/);
    await expect(attempt).rejects.toThrow(/FLEET_TEST_DB_LOCK_TIMEOUT_MS/);
  });

  it("deux prises sur la même base s'enchaînent : la seconde attend la libération de la première", async () => {
    const namespace = `fleet-test-selftest-${process.pid}`;
    const first = await acquireTestDbLock({ connectionString, namespace, owner: "premier", log: () => {} });

    const messages: string[] = [];
    let releasedAt = 0;
    let secondAt = 0;
    const second = acquireTestDbLock({
      connectionString,
      namespace,
      owner: "second",
      timeoutMs: 20000,
      pollMs: 200,
      log: (message) => messages.push(message),
    }).then((lock) => {
      secondAt = Date.now();
      return lock;
    });

    // La seconde prise attend : on guette son message d'attente (la connexion peut être lente sous charge).
    for (let i = 0; i < 150 && messages.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondAt).toBe(0);
    expect(messages[0]).toMatch(new RegExp(`^en attente du verrou de test \\(pid ${first.pid}, fleet-test-lock premier, depuis `));

    releasedAt = Date.now();
    await first.release();
    const lock = await second;
    expect(secondAt).toBeGreaterThanOrEqual(releasedAt);
    expect(lock.pid).not.toBe(first.pid);
    await lock.release();
    await lock.release(); // idempotent
  });

  it("délai configurable : valeur par défaut, valeur lue, valeur invalide refusée", () => {
    expect(lockTimeoutFromEnv({})).toBe(30 * 60 * 1000);
    expect(lockTimeoutFromEnv({ FLEET_TEST_DB_LOCK_TIMEOUT_MS: "5000" })).toBe(5000);
    expect(() => lockTimeoutFromEnv({ FLEET_TEST_DB_LOCK_TIMEOUT_MS: "bientôt" })).toThrow(/invalide/);
  });
});
