import { LOCKOUT_DEFAULTS, type LockoutConfig } from "@shared/contracts/auth-lockout";
import { normalizeLoginIdentifier } from "../lib/login-identifier";

export interface LockState {
  failedCount: number;
  lockedUntil: Date | null;
  lastFailedAt: Date | null;
}

export const EMPTY_LOCK_STATE: LockState = { failedCount: 0, lockedUntil: null, lastFailedAt: null };

/** Seuils : LOCKOUT_MAX_ATTEMPTS / LOCKOUT_MINUTES, sinon LOCKOUT_DEFAULTS. Valeurs invalides ignorees. */
export function lockoutConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LockoutConfig {
  const pos = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return {
    maxAttempts: pos(env.LOCKOUT_MAX_ATTEMPTS, LOCKOUT_DEFAULTS.maxAttempts),
    lockMinutes: pos(env.LOCKOUT_MINUTES, LOCKOUT_DEFAULTS.lockMinutes),
  };
}

/** Nom normalise : le compteur ne depend ni de la casse ni des espaces. */
/** Source unique : `server/lib/login-identifier.ts` (même normalisation pour la clé et l'empreinte). */
export const normalizeUsername = normalizeLoginIdentifier;

export const isLocked = (s: LockState, now: Date): boolean => !!s.lockedUntil && s.lockedUntil.getTime() > now.getTime();

/** Etat apres un echec. Un verrou expire repart de zero. Fonction pure. */
export function nextLockState(s: LockState, now: Date, cfg: LockoutConfig): LockState {
  const base = s.lockedUntil && !isLocked(s, now) ? EMPTY_LOCK_STATE : s;
  const failedCount = base.failedCount + 1;
  const lockedUntil =
    failedCount >= cfg.maxAttempts ? new Date(now.getTime() + cfg.lockMinutes * 60_000) : base.lockedUntil;
  return { failedCount, lockedUntil, lastFailedAt: now };
}

/**
 * Stockage du compteur. L'implementation base (un seul UPDATE ... RETURNING
 * atomique sur la table de db-1) vient apres le schema.
 */
export interface LockoutStore {
  get(username: string): Promise<LockState>;
  registerFailure(username: string, now: Date, cfg: LockoutConfig): Promise<LockState>;
  reset(username: string): Promise<void>;
}

/** Magasin memoire : tests et repli sans table. */
export class MemoryLockoutStore implements LockoutStore {
  private m = new Map<string, LockState>();
  async get(u: string) {
    return this.m.get(u) ?? EMPTY_LOCK_STATE;
  }
  async registerFailure(u: string, now: Date, cfg: LockoutConfig) {
    const next = nextLockState(this.m.get(u) ?? EMPTY_LOCK_STATE, now, cfg);
    this.m.set(u, next);
    return next;
  }
  async reset(u: string) {
    this.m.delete(u);
  }
}
