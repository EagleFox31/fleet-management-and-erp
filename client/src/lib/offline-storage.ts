import type { QueryClient } from "@tanstack/react-query";
import { clientLogger } from "@/lib/logger";
import { applyRestoredQueries } from "@/lib/offline-restore";
import { pendingServerLogout } from "@/lib/pending-logout";
import { purgeBrowserUserState } from "@/lib/form-draft-storage";
import {
  DRIVER_READ_PROFILE,
  confirmOfflineSession,
  getActiveOfflineUserId,
  markOfflineSessionUnconfirmed,
  setActiveOfflineUserId,
  subscribeActiveOfflineUser,
} from "@/lib/offline-user-scope";
import { offlineResume, offlineScope } from "@/lib/offline-kv";
import { resumeFlagNames, type FlagSnapshot } from "@/lib/offline-resume";
import { resolveClientFeatureFlags } from "@/hooks/use-feature";
import type { OfflineGrantInfo } from "@/lib/session-check";
import { sessionChannel, type SessionChannelMessage } from "@/lib/offline-session-channel";
import {
  announceKeptSends,
  cancelScheduledReplay,
  enqueueOfflineWrite,
  isOfflineFlagEnabled,
  replayOfflineQueue,
  replayOnReconnect,
  startOfflineQueueRuntime,
} from "@/lib/offline-queue";
import { FEATURE_FLAGS_PATH, isFeatureKey } from "@shared/feature-flags";
import { releaseReplayGate } from "@/lib/offline-replay-gate";
import { OFFLINE_QUEUED_MESSAGE } from "@/lib/offline-queue-core";
import { toast } from "@/hooks/use-toast";

/**
 * Stockage hors ligne cloisonné par utilisateur.
 *
 * Une base IndexedDB par compte (`fleetos-offline-u<id>`), une liste blanche de
 * requêtes persistées et une file d'écritures par compte. La logique pure est dans
 * `offline-user-scope.ts` ; l'adaptateur idb-keyval dans `offline-kv.ts` ; la file
 * d'écritures (v2) dans `offline-queue-core.ts` / `offline-queue.ts`. Ce module
 * branche le tout sur le QueryClient et la reconnexion réseau.
 *
 * Pour le lot hors ligne technicien : lire et écrire par `getActiveOfflineUserId()`
 * et `offlineScope` (jamais par une clé globale), purger par `purgeOfflineSession`,
 * mettre en file par `enqueueOfflineWrite` (registre `offline-action-registry.ts`).
 */

export { offlineScope };

export interface OfflineAction {
  type: "fuel_entry" | "work_order_note" | "odometer_reading";
  endpoint: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  label: string;
  missionId?: number;
  idempotencyKey?: string;
}

/** Relevé à chaque déconnexion, expiration ou changement de compte : une reprise en cours qui le voit bouger s'abandonne. */
let sessionGeneration = 0;

/**
 * Appelé à chaque connexion et à chaque restauration de session. Si l'utilisateur
 * change, le cache TanStack du précédent est vidé, ses copies hors ligne et
 * l'ancien format global (propriétaire inconnu) sont détruits.
 */
export function activateOfflineUser(
  queryClient: QueryClient,
  userId: number,
  options: { broadcast?: boolean } = {},
): void {
  // Session confirmée par le serveur (connexion ou /me) : si le compte avait été rouvert depuis le
  // marqueur, la file qui attendait cette confirmation peut enfin partir.
  const wasUnconfirmed = confirmOfflineSession(userId);
  if (getActiveOfflineUserId() === userId) {
    if (wasUnconfirmed) void replayOfflineQueue({ ignoreBackoff: true });
    return;
  }
  sessionGeneration += 1;
  queryClient.clear();
  setActiveOfflineUserId(userId);
  // Autre compte : le marqueur de reprise de l'ancien ne doit pas survivre (celui du nouveau est écrit après /me).
  void offlineResume.clearIfNotUser(userId).catch(logResumeFailure);
  // Cookie partagé : les autres onglets cessent de rejouer au nom de l'ancien compte.
  if (options.broadcast !== false) sessionChannel.post({ type: "session-changed", userId });
  void offlineScope.purgeLegacy();
  cancelScheduledReplay();
  // Changement de compte : les copies et les envois en attente de l'autre compte sont détruits (S1).
  void offlineScope.purgeOthers(userId, { dropQueues: true }).then((count) => {
    if (count > 0) {
      clientLogger.warn("Données hors ligne d'un autre compte supprimées", { count });
    }
  });
}

/**
 * Déconnexion : plus aucun utilisateur actif, cache TanStack vidé, magasins
 * hors ligne (cache et file d'écritures) vidés. Ne lève jamais.
 */
export async function purgeOfflineSession(
  queryClient: QueryClient,
  options: { broadcast?: boolean } = {},
): Promise<boolean> {
  let complete = true;
  sessionGeneration += 1;
  const active = getActiveOfflineUserId();
  setActiveOfflineUserId(null);
  cancelScheduledReplay();
  // Le marqueur de reprise part en premier : plus aucun démarrage hors ligne ne rouvre ce compte.
  await offlineResume.clear(active).catch((err) => {
    complete = false;
    logResumeFailure(err);
  });
  // Les autres onglets de l'appareil se purgent aussi (la file est partagée entre onglets).
  if (options.broadcast !== false) sessionChannel.post({ type: "logout" });
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à la déconnexion en échec", { err });
  }
  queryClient.clear();
  try {
    await offlineScope.purgeAll(active, { dropOtherQueues: true });
  } catch (err) {
    complete = false;
    clientLogger.error("Purge du stockage hors ligne en échec", { err });
  }
  return complete;
}

/** Même purge locale que la déconnexion (`auth.ts`) : magasins hors ligne, cache TanStack, état navigateur. */
async function purgeAfterLogout(queryClient: QueryClient): Promise<boolean> {
  const complete = await purgeOfflineSession(queryClient);
  purgeBrowserUserState();
  return complete;
}

/**
 * Session expirée côté serveur (401) alors que `userId` était actif : plus aucun
 * utilisateur actif et cache TanStack vidé, mais les magasins hors ligne de ce
 * compte, file d'écritures comprise, sont conservés pour sa prochaine connexion.
 * Sans effet si un autre compte (ou aucun) est devenu actif entre-temps.
 */
export async function expireOfflineSession(queryClient: QueryClient, userId: number): Promise<void> {
  if (getActiveOfflineUserId() !== userId) return;
  sessionGeneration += 1;
  setActiveOfflineUserId(null);
  cancelScheduledReplay();
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à l'expiration de session en échec", { err });
  }
  queryClient.clear();
  // Session expirée : plus de lecture hors ligne pour ce compte (la file d'envois est gardée).
  await offlineScope.dropUserReadCache(userId);
  await offlineResume.clear(userId).catch(logResumeFailure);
  // Envois gardés : l'utilisateur est prévenu qu'il doit se reconnecter pour qu'ils partent.
  void announceKeptSends(userId);
}

function logResumeFailure(err: unknown): void {
  clientLogger.warn("Marqueur de reprise hors ligne non mis à jour", { err });
}

/**
 * Valeur des drapeaux de reprise lue sur le réseau (cache TanStack des drapeaux), `null` tant
 * qu'elle n'a pas répondu : le marqueur garde alors la valeur précédente de ce compte.
 */
function resumeFlagSnapshot(queryClient: QueryClient): FlagSnapshot | null {
  const data = queryClient.getQueryData([FEATURE_FLAGS_PATH]);
  if (data === undefined) return null;
  const resolved = resolveClientFeatureFlags(data);
  const out: FlagSnapshot = {};
  for (const name of resumeFlagNames()) out[name] = isFeatureKey(name) && resolved[name] === true;
  return out;
}

/**
 * Après un `/api/auth/me` ou une connexion réussis : écrit (ou remplace) le marqueur de reprise
 * hors ligne du compte renvoyé. Un rôle sans profil de reprise efface le marqueur. Ne lève jamais.
 */
export async function recordOfflineResume(
  queryClient: QueryClient,
  user: { id: number; role: string },
  now: number = Date.now(),
): Promise<void> {
  try {
    await offlineResume.record({ id: user.id, role: user.role }, resumeFlagSnapshot(queryClient), now);
  } catch (err) {
    logResumeFailure(err);
  }
}

/** Contact réseau réussi du compte actif : repousse l'échéance du marqueur et rafraîchit ses drapeaux. */
export async function refreshOfflineResume(queryClient: QueryClient, now: number = Date.now()): Promise<void> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return;
  try {
    await offlineResume.touch(userId, resumeFlagSnapshot(queryClient), now);
  } catch (err) {
    logResumeFailure(err);
  }
}

/**
 * Une lecture réseau terminée avec succès, pas une écriture manuelle dans le cache (`setQueryData`,
 * dont la restauration hors ligne) : seule la première prouve que le serveur a répondu.
 */
export function isNetworkSuccess(event: { type: string; action?: { type?: string; manual?: boolean } }): boolean {
  return event.type === "updated" && event.action?.type === "success" && event.action.manual !== true;
}

/**
 * Seules les réponses réseau de `/api/feature-flags` et `/api/auth/me` prolongent la reprise : une
 * lecture quelconque (liste servie puis rafraîchie, copie restaurée) n'identifie pas la session.
 */
export function isContactProof(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === FEATURE_FLAGS_PATH || queryKey[0] === "/api/auth/me";
}

/**
 * Démarrage sans réseau : si le marqueur de reprise est valide (profil de lecture, 72 h, drapeaux
 * allumés au dernier contact), le compte devient l'utilisateur hors ligne actif et SA copie de
 * lecture est restaurée (marquée périmée, relue dès que le réseau répond). LECTURE SEULE : la file
 * d'envois n'est PAS rejouée (le compte reste « non confirmé » pour `replayOfflineQueue`) tant qu'un
 * `/api/auth/me` authentifié ou une connexion n'a pas confirmé la session dans cette page ; le cookie
 * reste l'unique preuve d'identité. Renvoie la reprise accordée (compte, profil de lecture, échéance), `null` sinon.
 *
 * Avant d'ouvrir quoi que ce soit, le marqueur est confronté au stockage : si la copie de lecture n'appartient
 * pas au compte du marqueur (enveloppe d'un autre propriétaire, ou copie d'un autre compte sur l'appareil),
 * tout est purgé et rien n'est rouvert.
 */
export async function resumeOfflineRead(queryClient: QueryClient, now: number = Date.now()): Promise<OfflineGrantInfo | null> {
  if (getActiveOfflineUserId() !== null) return null;
  // Une déconnexion (autre onglet) ou un changement de compte pendant les lectures asynchrones annule la reprise.
  const generation = sessionGeneration;
  const grant = await offlineResume.read(now);
  if (!grant) return null;
  if (getActiveOfflineUserId() !== null || generation !== sessionGeneration) return null;
  let ownership: "ok" | "foreign" | "unknown";
  try {
    ownership = await offlineScope.cacheOwnership(grant.userId);
  } catch (err) {
    // Propriétaire illisible : on ne rouvre pas ce qu'on ne sait pas attribuer.
    clientLogger.warn("Propriétaire du cache hors ligne illisible, reprise refusée", { err });
    return null;
  }
  if (getActiveOfflineUserId() !== null || generation !== sessionGeneration) return null;
  if (ownership === "unknown") {
    // Magasins non énumérables : impossible d'exclure la copie d'un autre compte, on ne rouvre rien.
    clientLogger.warn("Magasins hors ligne non énumérables, reprise refusée");
    return null;
  }
  if (ownership === "foreign") {
    clientLogger.warn("Cache hors ligne d'un autre compte que le marqueur de reprise, purge locale");
    await purgeOfflineSession(queryClient);
    return null;
  }
  markOfflineSessionUnconfirmed(grant.userId);
  setActiveOfflineUserId(grant.userId);
  await restoreQueryClientFromIndexedDB(queryClient, grant.isFlagOn, now);
  return { userId: grant.userId, profile: grant.profile, expiresAt: grant.expiresAt };
}

/** Message d'un autre onglet. Exporté pour être testé sans canal réel. */
export function onSessionChannelMessage(queryClient: QueryClient, message: SessionChannelMessage): void {
  if (message.type === "logout") void purgeOfflineSession(queryClient, { broadcast: false });
  // Un autre compte s'est connecté dans un autre onglet : cet onglet adopte ce compte, ce qui
  // arrête tout rejeu en cours pour l'ancien (garde `aborted` de la file). Le marqueur d'un autre
  // compte est périmé ; celui du même compte, écrit par l'autre onglet, reste.
  if (message.type === "session-changed") {
    void offlineResume.clearIfNotUser(message.userId).catch(logResumeFailure);
    if (getActiveOfflineUserId() !== message.userId) {
      activateOfflineUser(queryClient, message.userId, { broadcast: false });
    }
  }
}

/** Lecteur de drapeaux des profils de lecture hors ligne (un drapeau inconnu est éteint). */
const readFlag = (flag: string): boolean => isFeatureKey(flag) && isOfflineFlagEnabled(flag);

/**
 * Persiste dans IndexedDB les seules requêtes de la liste blanche, dans le
 * magasin de l'utilisateur actif.
 */
export async function persistQueryClientToIndexedDB(queryClient: QueryClient): Promise<void> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return;
  const flagsKnown = queryClient.getQueryData([FEATURE_FLAGS_PATH]) !== undefined;
  try {
    await offlineScope.saveCache(
      userId,
      queryClient.getQueryCache().getAll().map((query) => ({
        queryKey: query.queryKey,
        state: {
          data: query.state.data,
          status: query.state.status,
          dataUpdatedAt: query.state.dataUpdatedAt,
        },
      })),
      Date.now(),
      readFlag,
      { dropIfEmpty: flagsKnown && !DRIVER_READ_PROFILE.flags.every(readFlag) },
    );
  } catch (err) {
    clientLogger.warn("Échec de sauvegarde du cache dans IndexedDB", { err });
  }
}

/**
 * Restaure au démarrage le cache de l'utilisateur actif, sans écraser une donnée
 * déjà plus récente en mémoire.
 */
export async function restoreQueryClientFromIndexedDB(
  queryClient: QueryClient,
  isFlagOn: (flag: string) => boolean = readFlag,
  now: number = Date.now(),
): Promise<number> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return 0;
  try {
    const queries = await offlineScope.loadCache(userId, now, isFlagOn);
    // L'utilisateur a pu changer pendant la lecture : ne rien appliquer.
    if (getActiveOfflineUserId() !== userId) return 0;

    return applyRestoredQueries(queryClient, queries);
  } catch (err) {
    clientLogger.warn("Échec de restauration du cache IndexedDB", { err });
    return 0;
  }
}

/**
 * Ancienne API de mise en file, conservée pour les appelants existants : elle délègue
 * à la file v2 (clé d'idempotence stable, rejeu FIFO). Sans les drapeaux, la mise en
 * file est refusée et l'appelant est prévenu.
 */
export async function enqueueOfflineAction(action: OfflineAction): Promise<void> {
  const result = await enqueueOfflineWrite({
    type: action.type,
    payload: action.payload,
    endpoint: action.endpoint,
    method: action.method,
    missionId: action.missionId,
    label: action.label,
    idempotencyKey: action.idempotencyKey,
  });
  if (result.queued) {
    toast({ title: "Mode Hors-Ligne", description: OFFLINE_QUEUED_MESSAGE });
    return;
  }
  clientLogger.warn("Mise en file hors-ligne refusée", { label: action.label, reason: result.reason });
  toast({
    title: "Action non enregistrée",
    description:
      result.reason === "disabled"
        ? "L'enregistrement hors ligne n'est pas activé. Réessayez avec du réseau."
        : "Reconnectez-vous pour enregistrer cette action hors ligne.",
    variant: "destructive",
  });
}

/** Écart minimal entre deux écritures du marqueur de reprise sur contact réseau. */
const RESUME_TOUCH_INTERVAL_MS = 60_000;

/**
 * Initialise les écouteurs de persistance automatique et de reconnexion
 */
export function setupOfflinePersistence(queryClient: QueryClient): () => void {
  // Restauration initiale (utilisateur déjà connu) puis à chaque connexion
  void restoreQueryClientFromIndexedDB(queryClient);
  const unsubscribeUser = subscribeActiveOfflineUser((userId) => {
    if (userId !== null) void restoreQueryClientFromIndexedDB(queryClient);
  });
  const stopQueueRuntime = startOfflineQueueRuntime();

  // Un autre onglet s'est déconnecté : cet onglet se purge aussi, sans réémettre.
  const unsubscribeChannel = sessionChannel.subscribe((message) => onSessionChannelMessage(queryClient, message));

  // Contact réseau réussi : l'échéance du marqueur de reprise suit le DERNIER contact (jamais un
  // démarrage hors ligne). Écriture espacée d'une minute, sauf quand les drapeaux viennent d'arriver.
  let lastContactWrite = 0;
  const unsubscribeContact = queryClient.getQueryCache().subscribe((event) => {
    if (!isNetworkSuccess(event) || !isContactProof(event.query.queryKey)) return;
    const flagsArrived = event.query.queryKey[0] === FEATURE_FLAGS_PATH;
    const now = Date.now();
    if (!flagsArrived && now - lastContactWrite < RESUME_TOUCH_INTERVAL_MS) return;
    lastContactWrite = now;
    void refreshOfflineResume(queryClient, now);
  });

  // Sauvegarde debounced lors des modifications de cache
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      void persistQueryClientToIndexedDB(queryClient);
    }, 2000);
  });

  // Retour du réseau : déconnexion différée d'abord, puis rejeu de la file. La barrière
  // du resync temps réel est levée dans tous les cas (voir offline-replay-gate.ts).
  const handleOnline = () => {
    // La purge locale est refaite avant d'effacer le repère : une purge restée incomplète à la déconnexion
    // ne doit pas être oubliée parce que le serveur a fini par répondre. Repère gardé si elle échoue encore.
    void pendingServerLogout
      .flush({ beforeClear: () => purgeAfterLogout(queryClient) })
      .then((outcome) => (outcome !== "pending" ? replayOnReconnect() : undefined))
      .finally(() => releaseReplayGate());
  };

  window.addEventListener("online", handleOnline);

  return () => {
    unsubscribeUser();
    unsubscribeChannel();
    unsubscribeContact();
    stopQueueRuntime();
    unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
    window.removeEventListener("online", handleOnline);
  };
}
