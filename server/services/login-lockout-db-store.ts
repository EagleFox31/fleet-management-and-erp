import type { LockoutConfig } from "@shared/contracts/auth-lockout";
import { pool } from "../db";
import { recordAudit } from "../lib/audit";
import { loginIdentifierDigest, PASSWORD_DIGEST_KEY_PREFIX } from "../lib/login-identifier";
import {
  confirmedLockState,
  EMPTY_LOCK_STATE,
  isLocked,
  reservedLockState,
  type LockState,
  type LockoutStore,
  type Reservation,
} from "./login-lockout-service";

const toState = (r: { failed_count: number; locked_until: Date | null; last_failed_at: Date | null }): LockState => ({
  failedCount: r.failed_count,
  lockedUntil: r.locked_until,
  lastFailedAt: r.last_failed_at,
});

export type LockedUserRow = {
  id: number;
  username: string;
  name: string;
  role: string;
  failedLoginCount: number;
  lockedUntil: Date;
  lastFailedLoginAt: Date | null;
};

/** Espaces de cles : un identifiant « 5 » (mot de passe) n'est pas l'utilisateur d'id 5 (PIN). */
export const PASSWORD_KEY_PREFIX = "pwd:";
export const PIN_KEY_PREFIX = "pin:";
/**
 * Changement de mot de passe (`cpw:<userId>`) : essais sur le mot de passe actuel, compte de session.
 * Espace a part, sans miroir sur `users` : trop d'echecs ici bloquent le changement, pas la connexion.
 */
export const CHANGE_PASSWORD_KEY_PREFIX = "cpw:";

/**
 * Clé stockée pour une clé du garde (M3) : `pin:<id>` telle quelle (un id n'est pas une saisie libre),
 * sinon `pwdh1:` + empreinte du nom (`pwd:<nom>` ou clé brute). Le nom saisi ne quitte pas la mémoire :
 * il ne sert qu'au miroir `users`, comme paramètre de requête, jamais écrit.
 */
export function storedLockoutKey(key: string): string {
  if ([PIN_KEY_PREFIX, CHANGE_PASSWORD_KEY_PREFIX, PASSWORD_DIGEST_KEY_PREFIX].some((p) => key.startsWith(p))) return key;
  return PASSWORD_DIGEST_KEY_PREFIX + loginIdentifierDigest(legacyName(key));
}

/** Nom porté par une clé en clair (`pwd:<nom>` ou clé brute, format antérieur à M3). */
export function legacyName(key: string): string {
  return key.startsWith(PASSWORD_KEY_PREFIX) ? key.slice(PASSWORD_KEY_PREFIX.length) : key;
}

/** Cible du miroir `users` pour une cle : par id (pin:), sinon par nom d'utilisateur (pwd: ou cle brute). */
function mirrorTarget(key: string): { where: string; param: string | number } {
  // Aucun compte ne porte l'id -1 : pas de miroir pour le changement de mot de passe.
  if (key.startsWith(CHANGE_PASSWORD_KEY_PREFIX)) return { where: "id = $1", param: -1 };
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
      [storedLockoutKey(username)],
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
      [storedLockoutKey(username), now, until, cfg.maxAttempts],
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
        // Compte inconnu : l'empreinte, jamais le nom saisi.
        entityId: id !== undefined ? String(id) : storedLockoutKey(username),
        method: null,
        path: null,
        details: { lockedUntil: state.lockedUntil.toISOString(), failedCount: state.failedCount },
      });
    }
    return state;
  }

  /**
   * Lecture puis ecriture d'un compteur sous verrou consultatif de transaction, pris sur la cle :
   * les tentatives simultanees d'un meme compte passent une par une, y compris quand la ligne
   * n'existe pas encore (un FOR UPDATE ne verrouille rien sur une ligne absente).
   * `apply` calcule l'etat suivant (null = ne rien ecrire). Renvoie l'etat d'avant et d'apres.
   */
  private async withKeyLock(
    key: string,
    apply: (before: LockState | null) => LockState | null,
  ): Promise<{ before: LockState | null; after: LockState | null }> {
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["fleet-lockout:" + key]);
      const { rows } = await client.query(
        "SELECT failed_count, locked_until, last_failed_at FROM login_attempts_by_username WHERE username_normalized = $1",
        [key],
      );
      const before = rows[0] ? toState(rows[0]) : null;
      const after = apply(before);
      if (after) {
        await client.query(
          `INSERT INTO login_attempts_by_username (username_normalized, failed_count, locked_until, last_failed_at, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (username_normalized) DO UPDATE SET failed_count = EXCLUDED.failed_count,
             locked_until = EXCLUDED.locked_until, last_failed_at = EXCLUDED.last_failed_at, updated_at = now()`,
          [key, after.failedCount, after.lockedUntil, after.lastFailedAt],
        );
      }
      await client.query("COMMIT");
      return { before, after };
    } catch (err) {
      // Connexion dont le ROLLBACK echoue : detruite plutot que rendue au pool.
      await client.query("ROLLBACK").catch((rollbackErr: Error) => {
        broken = rollbackErr;
      });
      throw err;
    } finally {
      client.release(broken);
    }
  }

  /**
   * Audit `lock` au seul passage « non verrouille -> verrouille ». Sinon, miroir `users` sur un echec
   * confirme seulement : une reservation en cours n'est pas encore un echec.
   */
  private async afterWrite(username: string, before: LockState | null, after: LockState, now: Date, mirror: boolean): Promise<void> {
    if (isLocked(after, now) && !(before && isLocked(before, now))) await this.recordLock(username, after);
    else if (mirror) await this.mirror(username, after);
  }

  /**
   * Reservation atomique (voir LockoutStore.reserve), meme calcul que le store memoire.
   * `afterWrite` s'execute apres le COMMIT : s'il echoue (miroir, audit `lock`), la garde repond 503
   * alors que la tentative est deja comptee et jamais rendue. Fermee sur panne, voulu.
   */
  async reserve(username: string, now: Date, cfg: LockoutConfig): Promise<Reservation> {
    let reservation!: Reservation;
    const { before, after } = await this.withKeyLock(storedLockoutKey(username), (b) => {
      const current = b ?? EMPTY_LOCK_STATE;
      // Verrou actif : refus sans ecriture. Le compteur n'a plus d'effet tant que le verrou dure et une
      // fenetre expiree repart de zero ; sous attaque, chaque 429 ne coute plus un upsert ni un verrou de ligne.
      if (b && isLocked(b, now)) {
        reservation = { allowed: false, state: current };
        return null;
      }
      reservation = reservedLockState(current, now, cfg);
      return reservation.state;
    });
    if (after) await this.afterWrite(username, before, after, now, false);
    return reservation;
  }

  async confirmFailure(username: string, now: Date, cfg: LockoutConfig): Promise<LockState> {
    // Ligne absente : un succes simultane l'a remise a zero, rien a confirmer.
    const { before, after } = await this.withKeyLock(storedLockoutKey(username), (b) => (b ? confirmedLockState(b, now, cfg) : null));
    if (!after) return EMPTY_LOCK_STATE;
    await this.afterWrite(username, before, after, now, true);
    return after;
  }

  async release(username: string, now: Date): Promise<void> {
    await pool.query(
      `UPDATE login_attempts_by_username SET failed_count = GREATEST(failed_count - 1, 0), updated_at = $2::timestamp
       WHERE username_normalized = $1`,
      [storedLockoutKey(username), now],
    );
  }

  private async mirror(username: string, state: LockState): Promise<number | undefined> {
    const target = mirrorTarget(username);
    const mirror = await pool.query(
      `UPDATE users SET failed_login_count = $2, locked_until = $3, last_failed_login_at = $4
       WHERE ${target.where} RETURNING id`,
      [target.param, state.failedCount, state.lockedUntil, state.lastFailedAt],
    );
    return mirror.rows[0]?.id as number | undefined;
  }

  /** Miroir puis audit `lock`, une fois par verrou pose. */
  private async recordLock(username: string, state: LockState): Promise<void> {
    const id = await this.mirror(username, state);
    await recordAudit({
      userId: id ?? null,
      action: "lock",
      entityType: "user",
      // Compte inconnu : l'empreinte, jamais le nom saisi.
      entityId: id !== undefined ? String(id) : storedLockoutKey(username),
      method: null,
      path: null,
      details: { lockedUntil: state.lockedUntil!.toISOString(), failedCount: state.failedCount },
    });
  }

  async reset(username: string): Promise<void> {
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = $1", [storedLockoutKey(username)]);
    const target = mirrorTarget(username);
    await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL
       WHERE ${target.where} AND (failed_login_count <> 0 OR locked_until IS NOT NULL)`,
      [target.param],
    );
  }

  /**
   * Comptes verrouilles a `now` (T-13). Lu par le meme pilote (`pg`) que celui qui ecrit
   * `users.locked_until` : la colonne est un `timestamp` sans fuseau, rempli a partir d'une
   * `Date` que `pg` envoie en heure locale. Drizzle relit ce type comme de l'UTC : la liste
   * affichait l'heure de fin decalee du fuseau du serveur (+1 h a Douala) et gardait un
   * compte deverrouille une heure de trop.
   */
  async listLocked(now: Date): Promise<LockedUserRow[]> {
    const { rows } = await pool.query(
      `SELECT id, username, name, role, failed_login_count, locked_until, last_failed_login_at
       FROM users WHERE locked_until > $1 ORDER BY locked_until DESC`,
      [now],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      username: r.username,
      name: r.name,
      role: r.role,
      failedLoginCount: Number(r.failed_login_count ?? 0),
      lockedUntil: r.locked_until as Date,
      lastFailedLoginAt: (r.last_failed_login_at as Date | null) ?? null,
    }));
  }

  /** Deverrouillage admin (T-13). Renvoie false si l'utilisateur n'existe pas. */
  async unlockUser(userId: number, adminId: number | null): Promise<boolean> {
    const { rows } = await pool.query(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1 RETURNING lower(btrim(username)) AS u`,
      [userId],
    );
    if (!rows[0]) return false;
    await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [
      // Clé par empreinte (connexion), PIN et essais de change-password, plus les formats en clair antérieurs à M3 si la reprise ne les a pas encore vus.
      [storedLockoutKey(rows[0].u), rows[0].u, PASSWORD_KEY_PREFIX + rows[0].u, PIN_KEY_PREFIX + userId, CHANGE_PASSWORD_KEY_PREFIX + userId],
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
