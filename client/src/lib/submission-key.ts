import { isApiError } from "@/lib/api-error";
import { newRequestKey } from "@/lib/request-key";

/**
 * Clé d'une soumission qui écrit de l'argent (plein de mission), gardée tant que son issue est
 * inconnue. Une coupure réseau ou un 5xx ne dit pas si le serveur a écrit : fermer puis rouvrir la
 * fiche, ou recharger la page, doit renvoyer la MÊME clé, pour que le serveur rejoue au lieu de
 * débiter une seconde fois.
 *
 * - `take(fingerprint)` : clé de l'envoi. Une clé incertaine n'est reprise que pour la même saisie
 *   (même empreinte) ; une saisie différente est une nouvelle intention et reçoit une nouvelle clé,
 *   au lieu d'un 409. L'empreinte ne contient que ce que l'utilisateur saisit (pas l'heure par défaut
 *   du formulaire, recalculée à chaque ouverture).
 * - `settle(error?)` : issue connue (succès, 4xx) -> clé libérée ; issue inconnue -> clé conservée.
 * - `discard()` : annulation par l'utilisateur -> clé libérée, sauf si une issue reste inconnue.
 *
 * Stockage : `sessionStorage` (propre à l'onglet, survit au rechargement), repli en mémoire.
 * Deux onglets ont deux stockages, donc deux clés : deux saisies distinctes, voulu.
 */
type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredKey = { key: string; uncertain: boolean; fingerprint: string };

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
      if (parsed && typeof parsed.key === "string") {
        return {
          key: parsed.key,
          uncertain: parsed.uncertain === true,
          fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : "",
        };
      }
    } catch {
      // Valeur illisible : repli sur la copie en mémoire.
    }
    return current;
  };
  const write = (value: StoredKey | null) => {
    current = value;
    try {
      if (value) storage.setItem(storageKey, JSON.stringify(value));
      else storage.removeItem(storageKey);
    } catch {
      // Stockage plein ou refusé : la clé reste valable pour cet envoi, seul le rechargement la perd.
    }
  };

  // Copie en mémoire : la clé reste valable pour cet écran même si le stockage refuse l'écriture.
  let current: StoredKey | null = null;

  return {
    take(fingerprint: unknown = null): string {
      const print = JSON.stringify(fingerprint ?? null);
      const stored = read();
      if (stored && (!stored.uncertain || stored.fingerprint === print)) {
        write({ ...stored, fingerprint: print });
        return stored.key;
      }
      const key = newRequestKey();
      write({ key, uncertain: false, fingerprint: print });
      return key;
    },
    settle(error?: unknown): void {
      if (error !== undefined && isIndeterminateOutcome(error)) {
        const stored = read();
        if (stored) write({ ...stored, uncertain: true });
        return;
      }
      write(null);
    },
    discard(): void {
      if (read()?.uncertain) return;
      write(null);
    },
  };
}

export type SubmissionKeyStore = ReturnType<typeof createSubmissionKeyStore>;

/** En-tête lu par `server/middleware/idempotency-guard.ts` (`IDEMPOTENCY_HEADER`). */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Portée partagée par les écrans qui saisissent un plein sur une mission. */
export const missionFuelKeyScope = (missionId: number | string) => `mission-fuel-${missionId}`;

/**
 * Ajustement de stock d'une pièce : la portée inclut le delta, donc une nouvelle intention
 * (autre pièce, autre quantité) prend une nouvelle clé, et le réessai de la même intention
 * après une issue inconnue renvoie la même (le serveur répond 409 « vérifiez le stock »).
 */
export const partStockKeyScope = (partId: number | string, adjustment: number) => `part-stock-${partId}-${adjustment}`;

/**
 * Envoi sous clé : `take()` avant, `settle()` au succès, `settle(error)` en échec (la clé
 * n'est conservée que si l'issue est inconnue). `send` reçoit la clé à poser en en-tête.
 */
export async function sendWithSubmissionKey<T>(
  scope: string,
  send: (key: string) => Promise<T>,
  storage?: KeyStorage,
): Promise<T> {
  const store = createSubmissionKeyStore(scope, storage);
  const key = store.take();
  try {
    const result = await send(key);
    store.settle();
    return result;
  } catch (error) {
    store.settle(error);
    throw error;
  }
}
