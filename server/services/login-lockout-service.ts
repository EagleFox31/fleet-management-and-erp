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
/** Issue d'une reservation de tentative : `allowed` = la requete peut verifier le secret. */
export interface Reservation {
  allowed: boolean;
  state: LockState;
}

export interface LockoutStore {
  get(username: string): Promise<LockState>;
  registerFailure(username: string, now: Date, cfg: LockoutConfig): Promise<LockState>;
  reset(username: string): Promise<void>;
  /**
   * Reserve la tentative AVANT le travail couteux (bcrypt), en une ecriture atomique : +1 au compteur.
   * Refusee si un verrou est actif, ou si elle depasse le seuil (le verrou est alors pose).
   * Sans cela, N requetes simultanees lisent toutes « non verrouille » et verifient toutes le secret.
   */
  reserve(username: string, now: Date, cfg: LockoutConfig): Promise<Reservation>;
  /** Echec confirme (401) d'une tentative reservee : pose le verrou au seuil. */
  confirmFailure(username: string, now: Date, cfg: LockoutConfig): Promise<LockState>;
  /** Rend une tentative reservee qui n'a verifie aucun secret (corps invalide, 400). */
  release(username: string, now: Date): Promise<void>;
}

/** Echec confirme (401) d'une tentative reservee : verrou pose au seuil. Fonction pure. */
export function confirmedLockState(s: LockState, now: Date, cfg: LockoutConfig): LockState {
  const lockedUntil =
    !s.lockedUntil && s.failedCount >= cfg.maxAttempts ? new Date(now.getTime() + cfg.lockMinutes * 60_000) : s.lockedUntil;
  return { failedCount: s.failedCount, lockedUntil, lastFailedAt: now };
}

/** Etat apres reservation. Un verrou expire repart de zero. Fonction pure. */
export function reservedLockState(s: LockState, now: Date, cfg: LockoutConfig): Reservation {
  const base = s.lockedUntil && !isLocked(s, now) ? EMPTY_LOCK_STATE : s;
  const failedCount = base.failedCount + 1;
  const lockedUntil =
    !base.lockedUntil && failedCount > cfg.maxAttempts ? new Date(now.getTime() + cfg.lockMinutes * 60_000) : base.lockedUntil;
  const state = { failedCount, lockedUntil, lastFailedAt: base.lastFailedAt };
  return { allowed: !isLocked(state, now) && failedCount <= cfg.maxAttempts, state };
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
  async reserve(u: string, now: Date, cfg: LockoutConfig) {
    const current = this.m.get(u) ?? EMPTY_LOCK_STATE;
    if (isLocked(current, now)) return { allowed: false, state: current }; // meme regle que le store base : rien a ecrire
    const r = reservedLockState(current, now, cfg);
    this.m.set(u, r.state);
    return r;
  }
  async confirmFailure(u: string, now: Date, cfg: LockoutConfig) {
    const s = this.m.get(u);
    if (!s) return EMPTY_LOCK_STATE;
    const next = confirmedLockState(s, now, cfg);
    this.m.set(u, next);
    return next;
  }
  async release(u: string) {
    const s = this.m.get(u);
    if (s) this.m.set(u, { ...s, failedCount: Math.max(s.failedCount - 1, 0) });
  }
}
