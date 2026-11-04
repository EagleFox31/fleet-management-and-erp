import { pool as defaultPool } from "../db";
import { moduleLogger } from "../lib/logger";
import { PASSWORD_DIGEST_KEY_PREFIX } from "../lib/login-identifier";
import { PIN_KEY_PREFIX, storedLockoutKey } from "./login-lockout-db-store";

const log = moduleLogger("login-identifier-migration");

/** Clé en clair : ni PIN (`pin:<id>`), ni empreinte (`pwdh1:`). Préfixes constants, sans `_` ni `%`. */
const PLAIN_KEY_FILTER = `username_normalized NOT LIKE '${PIN_KEY_PREFIX}%' AND username_normalized NOT LIKE '${PASSWORD_DIGEST_KEY_PREFIX}%'`;
/** Ligne d'audit de blocage d'un nom inconnu, encore en clair. */
const PLAIN_LOCK_AUDIT_FILTER = `action = 'lock' AND entity_type = 'user' AND entity_ref IS NOT NULL
  AND entity_ref NOT LIKE '${PIN_KEY_PREFIX}%' AND entity_ref NOT LIKE '${PASSWORD_DIGEST_KEY_PREFIX}%'`;

export interface LoginIdentifierMigrationResult {
  /** Lignes de compteur en clair reprises (fusionnées vers leur empreinte puis supprimées). */
  attempts: number;
  /** Lignes d'audit `lock` à nom inconnu dont `entity_ref` passe à l'empreinte. */
  audits: number;
}

/**
 * Reprise M3, au démarrage : les clés de `login_attempts_by_username` écrites en clair (`pwd:<nom>`,
 * clé brute) passent à `pwdh1:<empreinte>`, et l'audit `lock` d'un nom inconnu aussi.
 *
 * - Idempotente : ne lit que les lignes encore en clair. Rien à reprendre = aucune transaction ouverte,
 *   aucune écriture.
 * - Fusion : deux clés d'un même nom (`Alice` brute et `pwd:alice`) gardent le maximum de chaque champ.
 * - Audit : seules les lignes `lock` à nom inconnu sont réécrites (un nom saisi n'a pas à rester en base).
 *   C'est une modification de l'historique, assumée et comptée ; les lignes d'un compte connu (id) ne
 *   bougent pas.
 * - Une seule transaction. Les logs ne portent que des compteurs, jamais un nom ni une empreinte.
 */
export async function migrateLoginIdentifiers(pool: typeof defaultPool = defaultPool): Promise<LoginIdentifierMigrationResult> {
  const pending = await pool.query(
    `SELECT (SELECT count(*) FROM login_attempts_by_username WHERE ${PLAIN_KEY_FILTER})::int AS attempts,
            (SELECT count(*) FROM activity_logs WHERE ${PLAIN_LOCK_AUDIT_FILTER})::int AS audits`,
  );
  if (pending.rows[0].attempts === 0 && pending.rows[0].audits === 0) return { attempts: 0, audits: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const attempts = await client.query(
      `SELECT username_normalized AS key, failed_count, locked_until, last_failed_at, updated_at
       FROM login_attempts_by_username WHERE ${PLAIN_KEY_FILTER} FOR UPDATE`,
    );
    for (const row of attempts.rows) {
      await client.query(
        `INSERT INTO login_attempts_by_username AS t (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username_normalized) DO UPDATE SET
           failed_count = GREATEST(t.failed_count, EXCLUDED.failed_count),
           locked_until = GREATEST(t.locked_until, EXCLUDED.locked_until),
           last_failed_at = GREATEST(t.last_failed_at, EXCLUDED.last_failed_at),
           updated_at = GREATEST(t.updated_at, EXCLUDED.updated_at)`,
        [storedLockoutKey(row.key), row.failed_count, row.locked_until, row.last_failed_at, row.updated_at],
      );
      await client.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [row.key]);
    }
    const audits = await client.query(`SELECT id, entity_ref FROM activity_logs WHERE ${PLAIN_LOCK_AUDIT_FILTER} FOR UPDATE`);
    for (const row of audits.rows) {
      await client.query("UPDATE activity_logs SET entity_ref = $2 WHERE id = $1", [row.id, storedLockoutKey(row.entity_ref)]);
    }
    await client.query("COMMIT");
    const result = { attempts: attempts.rowCount ?? 0, audits: audits.rowCount ?? 0 };
    log.info(result, "identifiants de connexion en clair repris vers leur empreinte");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
