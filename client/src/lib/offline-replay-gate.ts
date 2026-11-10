import { clientLogger } from "@/lib/logger";

/**
 * Coordination entre le rejeu de la file hors ligne et le resync temps réel.
 *
 * Au retour du réseau, `useRealTimeSync` voulait relire les données critiques en même temps
 * que la file rejoue : la relecture pouvait finir avant l'envoi et afficher l'état d'avant.
 * Ce module pose, au tout premier événement `online` (son écouteur est enregistré à l'import,
 * avant ceux qui s'abonnent plus tard), une barrière que le rejeu lève à sa fin ; le resync
 * attend cette barrière. Si personne ne la lève, un délai maximal rend la main (le
 * comportement d'avant est conservé).
 *
 * Après vidange de la file, un seul resync forcé est demandé (`requestResyncAfterDrain`),
 * exécuté par le gestionnaire que `useRealTimeSync` enregistre.
 */

export const REPLAY_GATE_MAX_WAIT_MS = 20_000;

type Waiter = () => void;

let open = true;
let waiters: Waiter[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let resyncHandler: (() => void) | null = null;

function releaseAll(): void {
  open = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) waiter();
}

/** Ferme la barrière : un rejeu va commencer. À appeler de façon synchrone. */
export function beginReplayGate(): void {
  if (!open) return;
  open = false;
  timer = setTimeout(() => {
    clientLogger.warn("Barrière de rejeu levée par délai");
    releaseAll();
  }, REPLAY_GATE_MAX_WAIT_MS);
}

/** Lève la barrière (rejeu terminé, ignoré ou impossible). Sans effet si déjà levée. */
export function releaseReplayGate(): void {
  releaseAll();
}

/** Résolue tout de suite si aucun rejeu n'est attendu, sinon à la fin du rejeu. */
export function whenReplaySettled(): Promise<void> {
  if (open) return Promise.resolve();
  return new Promise<void>((resolve) => waiters.push(resolve));
}

/** Enregistré par `useRealTimeSync` : relecture critique forcée. */
export function setOfflineResyncHandler(handler: (() => void) | null): void {
  resyncHandler = handler;
}

/** Un seul resync après vidange de la file ; sans gestionnaire, rien (les tests, l'écran de connexion). */
export function requestResyncAfterDrain(): void {
  try {
    resyncHandler?.();
  } catch (err) {
    clientLogger.warn("Resync après rejeu en échec", { err });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", beginReplayGate);
}

/** Test seulement : remet la barrière à l'état initial. */
export function resetReplayGateForTests(): void {
  releaseAll();
  resyncHandler = null;
}
