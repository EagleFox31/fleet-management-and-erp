import { isApiError } from "@/lib/api-error";
import { newRequestKey } from "@/lib/request-key";

/**
 * Clé d'une soumission qui écrit de l'argent (plein de mission), gardée tant que son issue est
 * inconnue. Une coupure réseau ou un 5xx ne dit pas si le serveur a écrit : fermer puis rouvrir la
 * fiche, ou recharger la page, doit renvoyer la MÊME clé, pour que le serveur rejoue au lieu de
 * débiter une seconde fois.
 *
 * - `take()` : clé de l'envoi (la clé conservée, sinon une nouvelle).
 * - `settle(error?)` : issue connue (succès, 4xx) -> clé libérée ; issue inconnue -> clé conservée.
 * - `discard()` : annulation par l'utilisateur -> clé libérée, sauf si une issue reste inconnue.
 *
 * Stockage : `sessionStorage` (propre à l'onglet, survit au rechargement), repli en mémoire.
 * Deux onglets ont deux stockages, donc deux clés : deux saisies distinctes, voulu.
 */
type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredKey = { key: string; uncertain: boolean };

const memory = new Map<string, string>();
const memoryStorage: KeyStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

function defaultStorage(): KeyStorage {
  try {
    const storage = globalThis.sessionStorage;
    const probe = "fleetos-submission-key-probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage;
  }
}

/** Issue inconnue : le serveur a pu écrire. Réseau (pas de réponse) ou 5xx. */
export function isIndeterminateOutcome(error: unknown): boolean {
  return !isApiError(error) || error.status >= 500;
}

export function createSubmissionKeyStore(scope: string, storage: KeyStorage = defaultStorage()) {
  const storageKey = `fleetos-submission-key-${scope}`;

  const read = (): StoredKey | null => {
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) ?? "null");
      return parsed && typeof parsed.key === "string" ? { key: parsed.key, uncertain: parsed.uncertain === true } : null;
    } catch {
      return null;
    }
  };
  const write = (value: StoredKey | null) => {
    try {
      if (value) storage.setItem(storageKey, JSON.stringify(value));
      else storage.removeItem(storageKey);
    } catch {
      // Stockage plein ou refusé : la clé reste valable pour cet envoi, seul le rechargement la perd.
    }
  };

  let inFlight: string | null = null;

  return {
    take(): string {
      const key = inFlight ?? read()?.key ?? newRequestKey();
      inFlight = key;
      write({ key, uncertain: read()?.uncertain ?? false });
      return key;
    },
    settle(error?: unknown): void {
      if (error !== undefined && isIndeterminateOutcome(error)) {
        const key = inFlight ?? read()?.key;
        if (key) write({ key, uncertain: true });
        return;
      }
      inFlight = null;
      write(null);
    },
    discard(): void {
      if (read()?.uncertain) return;
      inFlight = null;
      write(null);
    },
    /** Vrai si un envoi précédent n'a pas eu d'issue connue (à signaler avant une nouvelle saisie). */
    hasUncertainSubmission(): boolean {
      return read()?.uncertain === true;
    },
  };
}

export type SubmissionKeyStore = ReturnType<typeof createSubmissionKeyStore>;

/** Portée partagée par les écrans qui saisissent un plein sur une mission. */
export const missionFuelKeyScope = (missionId: number | string) => `mission-fuel-${missionId}`;
