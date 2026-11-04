import bcrypt from "bcryptjs";
import type { PoolClient } from "@neondatabase/serverless";
import { pool as defaultPool } from "../db";
import { moduleLogger } from "./logger";

const log = moduleLogger("pin-hash-migration");

/** Un hash bcrypt commence par `$2` (`$2a$`, `$2b$`, `$2y$`). */
export const BCRYPT_PREFIX = "$2";

/** Coût bcrypt commun à tous les secrets de connexion. */
export const PIN_BCRYPT_COST = 10;

export interface PinHashMigrationResult {
  /** PIN en clair repris (hachés puis réécrits). */
  hashed: number;
}

/**
 * Reprise au démarrage : tout `users.pin` non NULL qui n'est pas déjà un hash bcrypt est haché.
 *
 * - Idempotente : ne lit que les lignes hors préfixe bcrypt `$2a$`, `$2b$`, `$2y$` (même expression que la CHECK
 *   users_pin_bcrypt_check, server/db/migrations/20261104_users_pin_bcrypt_check.sql). Rien à reprendre = aucune écriture.
 * - Jouée au démarrage avant la pose de cette CHECK : son VALIDATE trouve alors une table sans clair.
 * - Un PIN en clair non conforme (autre chose que 4 chiffres) est haché aussi. Une valeur au préfixe `$2` non conforme n'est pas touchée (voir ci-dessous).
 * - Chaque réécriture est gardée par la valeur lue (`pin = <ancienne valeur>`) : un PIN changé entre-temps n'est pas écrasé.
 * - Ne journalise qu'un compteur, jamais une valeur.
 */
export async function hashPlainUserPins(pool: Pick<PoolClient, "query"> = defaultPool): Promise<PinHashMigrationResult> {
  // Valeur commençant par `$2` hors a/b/y (`$2x$…`, `$2` tronqué) : ressemble à un hash, jamais réécrite (pas de retour
  // arrière possible) ; comptée et signalée, la CHECK reste alors NOT VALID pour cette ligne.
  const { rows } = await pool.query<{ id: number; pin: string }>(
    `SELECT id, pin FROM users WHERE pin IS NOT NULL AND pin !~ '^[$]2'`,
  );
  const malformed = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE pin IS NOT NULL AND pin ~ '^[$]2' AND pin !~ '^[$]2[aby][$]'`,
  );
  if ((malformed.rows[0]?.n ?? 0) > 0) log.warn({ malformed: malformed.rows[0].n }, "PIN au préfixe $2 non conforme : laissés tels quels (à traiter à la main)");
  let hashed = 0;
  for (const row of rows) {
    const hash = await bcrypt.hash(row.pin, PIN_BCRYPT_COST);
    const result = await pool.query(`UPDATE users SET pin = $1 WHERE id = $2 AND pin = $3`, [hash, row.id, row.pin]);
    hashed += result.rowCount ?? 0;
  }
  if (hashed > 0) log.info({ hashed }, "PIN en clair repris : hachés");
  return { hashed };
}
