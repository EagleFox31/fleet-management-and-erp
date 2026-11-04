import bcrypt from "bcryptjs";
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
 * - Idempotente : ne lit que les lignes sans préfixe `$2`. Rien à reprendre = aucune écriture.
 * - Un PIN en clair non conforme (autre chose que 4 chiffres) est haché aussi : aucun clair ne reste en base.
 * - Chaque réécriture est gardée par la valeur lue (`pin = <ancienne valeur>`) : un PIN changé entre-temps n'est pas écrasé.
 * - Ne journalise qu'un compteur, jamais une valeur.
 */
export async function hashPlainUserPins(pool: typeof defaultPool = defaultPool): Promise<PinHashMigrationResult> {
  const { rows } = await pool.query<{ id: number; pin: string }>(
    `SELECT id, pin FROM users WHERE pin IS NOT NULL AND pin NOT LIKE '$2%'`,
  );
  let hashed = 0;
  for (const row of rows) {
    const hash = await bcrypt.hash(row.pin, PIN_BCRYPT_COST);
    const result = await pool.query(`UPDATE users SET pin = $1 WHERE id = $2 AND pin = $3`, [hash, row.id, row.pin]);
    hashed += result.rowCount ?? 0;
  }
  if (hashed > 0) log.info({ hashed }, "PIN en clair repris : hachés");
  return { hashed };
}
