import { DRAFT_KEY_PATTERN } from "@/lib/form-draft-storage";

/**
 * Mise à jour du service worker : quand un nouveau worker prend le contrôle (controllerchange), la page
 * tourne encore avec l'ancien build. On la recharge une seule fois, sauf si l'utilisateur a un brouillon
 * de formulaire non vide (AGENTS.md §6) : un bandeau « Nouvelle version disponible. Recharger » prend alors
 * le relais, le rechargement reste son choix.
 */

type DraftStorage = Pick<Storage, "length" | "key" | "getItem">;

/** Vrai si un brouillon de formulaire (clé `fleetos-<forme>-v<n>-<user>`) porte une saisie. Ne lève jamais. */
export function hasNonEmptyDraft(storage?: DraftStorage | null): boolean {
  try {
    const target = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!target) return false;
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (!key || !DRAFT_KEY_PATTERN.test(key)) continue;
      const raw = target.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { data?: unknown };
        if (parsed.data != null) return true;
      } catch {
        // brouillon illisible : il ne retient pas de saisie
      }
    }
    return false;
  } catch {
    return false;
  }
}

export interface UpdateDeps {
  /** Une page déjà contrôlée avant l'événement : sinon c'est la première prise de contrôle, rien à recharger. */
  hadController: boolean;
  hasDraft: () => boolean;
  reload: () => void;
  onUpdateAvailable: () => void;
}

/** Gestionnaire de `controllerchange` : rechargement unique, ou bandeau si une saisie est en cours. */
export function createControllerChangeHandler(deps: UpdateDeps): () => void {
  let handled = false;
  return () => {
    if (!deps.hadController || handled) return;
    handled = true;
    if (deps.hasDraft()) deps.onUpdateAvailable();
    else deps.reload();
  };
}

let updateAvailable = false;
const listeners = new Set<() => void>();

export function markUpdateAvailable(): void {
  updateAvailable = true;
  listeners.forEach((listener) => listener());
}

export function subscribeUpdateAvailable(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdateAvailable(): boolean {
  return updateAvailable;
}
