/**
 * Verrous de la file d'écritures hors ligne.
 *
 * - `tryRun` : exclusion tentée sans attente (un seul onglet rejoue la file).
 * - `run` : exclusion avec attente, pour les lectures-modifications-écritures de la file
 *   (deux onglets qui ajoutent ou marquent un envoi ne s'écrasent pas).
 *
 * `navigator.locks` (Web Locks) quand il existe ; sinon repli sur un bail dans le
 * stockage local avec durée de vie (un onglet tué ne bloque pas les autres) et sur une
 * exclusion en mémoire pour l'onglet courant. Dépendances injectées : testable sans navigateur.
 */

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown | null) => Promise<T> | T,
  ): Promise<T>;
  request<T>(name: string, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
}

export interface LeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LockDeps {
  locks: LockManagerLike | null;
  storage: () => LeaseStorage | null;
  now: () => number;
  /** Identifie cet onglet dans le bail de repli. */
  ownerId: string;
  /** Durée de vie d'un bail de repli, renouvelée à chaque `renew()`. */
  leaseMs: number;
}

export type TryRunResult<T> = { acquired: false } | { acquired: true; value: T };

export const LEASE_KEY_PREFIX = "fleetos-offline-lock:";

export function createLockProvider(deps: LockDeps) {
  const held = new Set<string>();
  const chains = new Map<string, Promise<unknown>>();

  function readLease(key: string): { owner: string; expires: number } | null {
    try {
      const raw = deps.storage()?.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { owner?: unknown; expires?: unknown };
      return typeof parsed.owner === "string" && typeof parsed.expires === "number"
        ? { owner: parsed.owner, expires: parsed.expires }
        : null;
    } catch {
      return null;
    }
  }

  function writeLease(key: string): void {
    try {
      deps.storage()?.setItem(key, JSON.stringify({ owner: deps.ownerId, expires: deps.now() + deps.leaseMs }));
    } catch {
      // Stockage indisponible : l'exclusion en mémoire reste la seule protection.
    }
  }

  async function tryRun<T>(name: string, fn: (renew: () => void) => Promise<T>): Promise<TryRunResult<T>> {
    if (held.has(name)) return { acquired: false };

    if (deps.locks) {
      held.add(name);
      try {
        return await deps.locks.request<TryRunResult<T>>(name, { ifAvailable: true }, async (lock) => {
          if (!lock) return { acquired: false };
          return { acquired: true, value: await fn(() => undefined) };
        });
      } finally {
        held.delete(name);
      }
    }

    const key = `${LEASE_KEY_PREFIX}${name}`;
    const current = readLease(key);
    if (current && current.owner !== deps.ownerId && current.expires > deps.now()) return { acquired: false };
    held.add(name);
    try {
      writeLease(key);
      // Deux onglets peuvent écrire presque ensemble : le dernier à écrire gagne, l'autre se retire.
      if (readLease(key)?.owner !== deps.ownerId) return { acquired: false };
      return { acquired: true, value: await fn(() => writeLease(key)) };
    } finally {
      held.delete(name);
      if (readLease(key)?.owner === deps.ownerId) {
        try {
          deps.storage()?.removeItem(key);
        } catch {
          // Le bail expirera seul.
        }
      }
    }
  }

  async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (deps.locks) {
      return deps.locks.request<T>(name, async () => fn());
    }
    const previous = chains.get(name) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    chains.set(name, next.catch(() => undefined));
    return next;
  }

  return { tryRun, run };
}

export type LockProvider = ReturnType<typeof createLockProvider>;
