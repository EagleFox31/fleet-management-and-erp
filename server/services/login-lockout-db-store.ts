import type { LockoutConfig } from "@shared/contracts/auth-lockout";
import { pool } from "../db";
import { recordAudit } from "../lib/audit";
import { EMPTY_LOCK_STATE, type LockState, type LockoutStore } from "./login-lockout-service";

const toState = (r: { failed_count: number; locked_until: Date | null; last_failed_at: Date | null }): LockState => ({
  failedCount: r.failed_count,
  lockedUntil: r.locked_until,
  lastFailedAt: r.last_failed_at,
});

/** Espaces de cles : un identifiant « 5 » (mot de passe) n'est pas l'utilisateur d'id 5 (PIN). */
export const PASSWORD_KEY_PREFIX = "pwd:";
export const PIN_KEY_PREFIX = "pin:";

/** Cible du miroir `users` pour une cle : par id (pin:), sinon par nom d'utilisateur (pwd: ou cle brute). */
function mirrorTarget(key: string): { where: string; param: string | number } {
  if (key.startsWith(PIN_KEY_PREFIX)) {
    const id = Number(key.slice(PIN_KEY_PREFIX.length));
    return { where: "id = $1", param: Number.isInteger(id) ? id : -1 };
  }
  const name = key.startsWith(PASSWORD_KEY_PREFIX) ? key.slice(PASSWORD_KEY_PREFIX.length) : key;
  return { where: "lower(btrim(username)) = $1", param: name };
}

/**
 * Compteur en base : un seul INSERT ... ON CONFLICT DO UPDATE ... RETURNING, donc
 * atomique face a des echecs simultanes. Miroir sur users si le compte existe.
 */
export class DbLockoutStore implements LockoutStore {
  async get(username: string): Promise<LockState> {
    const { rows } = await pool.query(
      "SELECT failed_count, locked_until, last_failed_at FROM login_attempts_by_username WHERE username_normalized = $1",
      [username],
    );
    return rows[0] ? toState(rows[0]) : EMPTY_LOCK_STATE;
  }

  async registerFailure(username: string, now: Date, cfg: LockoutConfig): Promise<LockState> {
    const until = new Date(now.getTime() + cfg.lockMinutes * 60_000);
    const { rows } = await pool.query(
      `INSERT INTO login_attempts_by_username AS t (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
       VALUES ($1, 1, CASE WHEN 1 >= $4::int THEN $3::timestamp ELSE NULL END, $2::timestamp, $2::timestamp)
       ON CONFLICT (username_normalized) DO UPDATE SET
         failed_count = CASE WHEN t.locked_until IS NOT NULL AND t.locked_until <= $2::timestamp THEN 1 ELSE t.failed_count + 1 END,
         locked_until = CASE
           WHEN (CASE WHEN t.locked_until IS NOT NULL AND t.locked_until <= $2::timestamp THEN 1 ELSE t.failed_count + 1 END) >= $4::int THEN $3::timestamp
           WHEN t.locked_until IS NOT NULL AND t.locked_until <= $2::timestamp THEN NULL
           ELSE t.locked_until END,
         last_failed_at = $2::timestamp,
         updated_at = $2::timestamp
       RETURNING failed_count, locked_until, last_failed_at`,
      [username, now, until, cfg.maxAttempts],
    );
    const state = toState(rows[0]);
    const target = mirrorTarget(username);
    const mirror = await pool.query(
      `UPDATE users SET failed_login_count = $2, locked_until = $3, last_failed_login_at = $4
       WHERE ${target.where} RETURNING id`,
      [target.param, state.failedCount, state.lockedUntil, state.lastFailedAt],
    );
    // Blocage audite une seule fois : l'echec qui atteint exactement le seuil.
    if (state.lockedUntil && state.failedCount === cfg.maxAttempts) {
      const id = mirror.rows[0]?.id as number | undefined;
      await recordAudit({
        userId: id ?? null,
        action: "lock",
        entityType: "user",
        entityId: id !== undefined ? String(id) : username,
        method: null,
        path: null,
        details: { lockedUntil: state.lockedUntil.toISOString(), failedCount: state.failedCount },
      });
    }
    return state;
  }

  async reset(username: string): Promise<void> {
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [username]);
    const target = mirrorTarget(username);
    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL
       WHERE ${target.where} AND (failed_login_count <> 0 OR locked_until IS NOT NULL)`,
      [target.param],
    );
  }

  /** Deverrouillage admin (T-13). Renvoie false si l'utilisateur n'existe pas. */
  async unlockUser(userId: number, adminId: number | null): Promise<boolean> {
    const { rows } = await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1 RETURNING lower(btrim(username)) AS u`,
      [userId],
    );
    if (!rows[0]) return false;
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [
      [rows[0].u, PASSWORD_KEY_PREFIX + rows[0].u, PIN_KEY_PREFIX + userId],
    ]);
    await recordAudit({
      userId: adminId,
      action: "unlock",
      entityType: "user",
      entityId: String(userId),
      method: null,
      path: null,
      details: null,
    });
    return true;
  }
}
