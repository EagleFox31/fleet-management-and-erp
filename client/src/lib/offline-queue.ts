import { FEATURE_FLAGS_PATH, type FeatureKey } from "@shared/feature-flags";
import { OFFLINE_OWNER_HEADER, isAutoReplayable } from "@shared/idempotency-routes";
import { NETWORK_ERROR_MESSAGE } from "@shared/errors";
import { ApiError, userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resolveClientFeatureFlags } from "@/hooks/use-feature";
import { toast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/logger";
import { checkSession } from "@/lib/session-check";
import { getActiveOfflineUserId, subscribeActiveOfflineUser } from "@/lib/offline-user-scope";
import { offlineScope } from "@/lib/offline-kv";
import { getOfflineAction, requiredFlagsOf } from "@/lib/offline-action-registry";
import { createLockProvider, type LockManagerLike } from "@/lib/offline-locks";
import { sessionChannel } from "@/lib/offline-session-channel";
import { releaseReplayGate, requestResyncAfterDrain } from "@/lib/offline-replay-gate";
import {
  OfflineQueueError,
  createOfflineQueue,
  reconnectMessage,
  type EnqueueInput,
  type OwnerCheck,
  type QueueEntry,
  type QueueEntryView,
  type ReplayOptions,
  type ReplayResult,
  type SendOutcome,
} from "@/lib/offline-queue-core";

/**
 * File d'écritures différées hors ligne : branchement du cœur (`offline-queue-core.ts`) sur
 * IndexedDB (par compte), le réseau, le QueryClient, les verrous entre onglets et les
 * drapeaux. API générique pour les lots chauffeur (V5b) et technicien (#10c) : un type
 * d'écriture s'ajoute au registre (`offline-action-registry.ts`), jamais ici.
 *
 * Tout est derrière les drapeaux : sans `offline-writes` (et ceux que le type exige), la
 * mise en file est refusée (l'écran garde son comportement actuel) et rien n'est rejoué.
 */

/** Clé d'idempotence envoyée à chaque rejeu. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** En-tête posé par le serveur sur une réponse rejouée. */
const REPLAYED_HEADER = "Idempotent-Replayed";

const LEASE_MS = 45_000;
/** Un envoi doit finir (ou échouer) avant l'expiration du bail du rejeu, sinon un autre onglet reprendrait la boucle. */
export const SEND_TIMEOUT_MS = LEASE_MS - 15_000;

/** En-têtes d'un envoi différé : clé d'idempotence stable et propriétaire de la file (vérifié par le serveur à chaque envoi). */
export function offlineRequestHeaders(entry: Pick<QueueEntry, "idempotencyKey" | "ownerUserId">): Record<string, string> {
  return { [IDEMPOTENCY_HEADER]: entry.idempotencyKey, [OFFLINE_OWNER_HEADER]: String(entry.ownerUserId) };
}

// ---------------------------------------------------------------------------
// Drapeaux
// ---------------------------------------------------------------------------

function flagsNow() {
  return resolveClientFeatureFlags(queryClient?.getQueryData([FEATURE_FLAGS_PATH]));
}

export function isOfflineFlagEnabled(key: FeatureKey): boolean {
  return flagsNow()[key];
}

/** Le rejeu exige `offline-writes` : sans lui le serveur ignore la clé et un rejeu écrirait deux fois. */
async function ensureOfflineWritesFlag(): Promise<boolean> {
  if (queryClient && queryClient.getQueryData([FEATURE_FLAGS_PATH]) === undefined) {
    try {
      await queryClient.fetchQuery({ queryKey: [FEATURE_FLAGS_PATH], staleTime: 10 * 60 * 1000 });
    } catch {
      // Drapeaux injoignables : les défauts (inactif) s'appliquent.
    }
  }
  return isOfflineFlagEnabled("offline-writes");
}

// ---------------------------------------------------------------------------
// Câblage du cœur
// ---------------------------------------------------------------------------

let multipartBuilder: ((entry: QueueEntry) => Promise<FormData>) | null = null;

/** Lot V5b-5 : construit le corps multipart d'un envoi à partir de ses fichiers stockés. */
export function setOfflineMultipartBuilder(builder: ((entry: QueueEntry) => Promise<FormData>) | null): void {
  multipartBuilder = builder;
}

async function sendEntry(entry: QueueEntry): Promise<SendOutcome> {
  try {
    let body: unknown = entry.payload;
    if (entry.kind === "multipart") {
      if (!multipartBuilder) {
        return { ok: false, status: 422, message: "La pièce jointe de cet envoi n'est plus disponible." };
      }
      body = await multipartBuilder(entry);
    }
    const response = await apiRequest(entry.endpoint, {
      method: entry.method,
      headers: offlineRequestHeaders(entry),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      body,
    });
    return { ok: true, replayed: response.headers.get(REPLAYED_HEADER) !== null };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, status: err.status, code: err.code, message: userMessageOf(err) };
    }
    // Aucun statut : réseau coupé ou réponse illisible. Le message reste lisible, sans détail technique.
    return { ok: false, message: userMessageOf(err, NETWORK_ERROR_MESSAGE) };
  }
}

async function checkOwner(): Promise<OwnerCheck> {
  const session = await checkSession();
  if (session.status === "authenticated") return { kind: "user", id: session.user.id };
  if (session.status === "anonymous") return { kind: "unauthorized" };
  return { kind: "unreachable" };
}

function createLocks() {
  const locks =
    typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as LockManagerLike) : null;
  return createLockProvider({
    locks,
    storage: () => {
      try {
        return typeof window === "undefined" ? null : window.localStorage;
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
    ownerId: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    leaseMs: LEASE_MS,
  });
}

const lockProvider = createLocks();

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Repli pour un contexte non sécurisé : suffisant pour une clé d'idempotence (unicité, non secret).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const offlineQueue = createOfflineQueue({
  store: {
    read: (userId) => offlineScope.readQueue<unknown>(userId),
    write: (userId, entries, epoch) => offlineScope.writeQueue(userId, entries, epoch),
    epochOf: (userId) => offlineScope.epochOf(userId),
  },
  getActiveUserId: getActiveOfflineUserId,
  send: sendEntry,
  checkOwner,
  withMutationLock: (userId, fn) => lockProvider.run(`queue-u${userId}`, fn),
  tryReplayLock: (userId, fn) => lockProvider.tryRun(`replay-u${userId}`, fn),
  getDefinition: getOfflineAction,
  isAutoReplayable: (entry) =>
    isAutoReplayable({
      method: entry.method,
      endpoint: entry.endpoint,
      idempotencyKey: entry.idempotencyKey,
      payload: entry.payload,
    }),
  invalidateFor: (entry) => {
    const definition = getOfflineAction(entry.type);
    if (!definition?.invalidations || !queryClient) return;
    const filters = definition.invalidations({ missionId: entry.missionId, payload: entry.payload });
    for (const filter of filters) void queryClient.invalidateQueries(filter);
  },
  onDrained: () => requestResyncAfterDrain(),
  onAuthStopped: (count) => {
    awaitingReconnect = true;
    scheduleRefresh();
    if (count > 0) toast({ title: "Envois en attente", description: reconnectMessage(count) });
  },
  announceChange: () => {
    sessionChannel.post({ type: "queue-changed" });
    scheduleRefresh();
  },
  now: () => Date.now(),
  uuid: newUuid,
});

// ---------------------------------------------------------------------------
// État observable (hook `useOfflineQueue`)
// ---------------------------------------------------------------------------

export interface OfflineQueueSnapshot {
  userId: number | null;
  pending: number;
  sending: number;
  rejected: number;
  /** Envois qui attendent de partir (en attente + en cours d'envoi). */
  waiting: number;
  total: number;
  /** Session refusée pendant un rejeu : la file est gardée, il faut se reconnecter. */
  awaitingReconnect: boolean;
  entries: readonly QueueEntryView[];
}

const EMPTY_SNAPSHOT: OfflineQueueSnapshot = {
  userId: null,
  pending: 0,
  sending: 0,
  rejected: 0,
  waiting: 0,
  total: 0,
  awaitingReconnect: false,
  entries: [],
};

let snapshot: OfflineQueueSnapshot = EMPTY_SNAPSHOT;
let awaitingReconnect = false;
const listeners = new Set<() => void>();
let refreshScheduled = false;

export function getOfflineQueueSnapshot(): OfflineQueueSnapshot {
  return snapshot;
}

export function subscribeOfflineQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameSnapshot(a: OfflineQueueSnapshot, b: OfflineQueueSnapshot): boolean {
  return (
    a.userId === b.userId &&
    a.awaitingReconnect === b.awaitingReconnect &&
    a.entries.length === b.entries.length &&
    a.entries.every((e, i) => {
      const o = b.entries[i];
      return e.id === o.id && e.state === o.state && e.attempts === o.attempts && e.lastError === o.lastError;
    })
  );
}

export async function refreshOfflineQueueSnapshot(): Promise<void> {
  const userId = getActiveOfflineUserId();
  let next = EMPTY_SNAPSHOT;
  if (userId !== null) {
    try {
      const entries = await offlineQueue.list(userId);
      // Le compte a pu changer pendant la lecture : on n'expose jamais la file d'un autre.
      if (getActiveOfflineUserId() !== userId) return refreshOfflineQueueSnapshot();
      const counts = offlineQueue.countOf(entries);
      next = {
        userId,
        ...counts,
        waiting: counts.pending + counts.sending,
        total: entries.length,
        awaitingReconnect,
        entries: entries.map(({ payload: _payload, ...view }) => view),
      };
    } catch (err) {
      clientLogger.warn("Lecture de la file hors ligne en échec", { err });
      return;
    }
  }
  if (sameSnapshot(snapshot, next)) return;
  snapshot = next;
  for (const listener of Array.from(listeners)) listener();
}

function scheduleRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    void refreshOfflineQueueSnapshot();
  });
}

// ---------------------------------------------------------------------------
// API des écrans
// ---------------------------------------------------------------------------

export type EnqueueWriteResult =
  | { queued: true; entry: QueueEntry }
  | { queued: false; reason: "disabled" | "no-user" | "session-changed" | "unknown-type" | "invalid" };

/**
 * Met une écriture en file si les drapeaux le permettent. `queued: false, reason: "disabled"` :
 * l'écran garde son comportement actuel (envoi direct, erreur réseau affichée). Aucun toast
 * ici : l'écran affiche `OFFLINE_QUEUED_MESSAGE`, et jamais « enregistré » avant le 2xx.
 */
export async function enqueueOfflineWrite(input: EnqueueInput): Promise<EnqueueWriteResult> {
  const definition = getOfflineAction(input.type);
  if (!definition) return { queued: false, reason: "unknown-type" };
  const flags = flagsNow();
  if (!requiredFlagsOf(definition).every((key) => flags[key])) return { queued: false, reason: "disabled" };
  try {
    const entry = await offlineQueue.enqueue(input);
    return { queued: true, entry };
  } catch (err) {
    if (err instanceof OfflineQueueError) return { queued: false, reason: err.reason };
    throw err;
  }
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(at: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      void replayOfflineQueue();
    },
    Math.max(0, at - Date.now()),
  );
}

export function cancelScheduledReplay(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/**
 * Rejoue la file du compte actif : retour du réseau, connexion, bouton manuel (`ignoreBackoff`)
 * ou minuterie de réessai. Ne lève jamais.
 */
export async function replayOfflineQueue(options: ReplayOptions = {}): Promise<ReplayResult> {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "skipped", reason: "empty" };
    if (getActiveOfflineUserId() === null) return { status: "skipped", reason: "no-user" };
    if (!(await ensureOfflineWritesFlag())) return { status: "skipped", reason: "empty" };

    const result = await offlineQueue.replay(options);
    if (result.status === "stopped" && result.reason === "retry" && result.nextAttemptAt !== undefined) {
      scheduleRetry(result.nextAttemptAt);
    }
    if (result.status !== "skipped") {
      if (result.rejected > 0) {
        toast({
          title: "Envois à revoir",
          description: `${result.rejected} ${result.rejected > 1 ? "envois ont été refusés" : "envoi a été refusé"} par le serveur. Ouvrez la liste des envois pour les revoir.`,
          variant: "destructive",
        });
      }
      if (result.status === "drained") awaitingReconnect = false;
    }
    scheduleRefresh();
    return result;
  } catch (err) {
    clientLogger.error("Erreur de rejeu de la file hors ligne", { err });
    return { status: "stopped", reason: "unreachable", sent: 0, rejected: 0, remaining: 0 };
  }
}

/** Nombre d'envois que la déconnexion détruirait. */
export async function pendingSendCount(): Promise<number> {
  const userId = getActiveOfflineUserId();
  // Compté même drapeau coupé : des envois déjà en file seraient détruits par la déconnexion.
  if (userId === null) return 0;
  try {
    return await offlineScope.queuedCount(userId);
  } catch {
    return 0;
  }
}

/** Supprime un envoi précis, à la demande explicite de l'utilisateur. */
export async function discardOfflineEntry(id: string): Promise<boolean> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return false;
  return offlineQueue.discard(userId, id);
}

/** Remet un envoi « À revoir » en attente (même clé), puis rejoue. */
export async function retryOfflineEntry(id: string): Promise<boolean> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return false;
  const ok = await offlineQueue.retryRejected(userId, id);
  if (ok) void replayOfflineQueue({ ignoreBackoff: true });
  return ok;
}

/** Session expirée avec des envois gardés : prévient l'utilisateur, ne supprime rien. */
export async function announceKeptSends(userId: number): Promise<void> {
  awaitingReconnect = true;
  try {
    const count = await offlineScope.queuedCount(userId);
    if (count > 0) toast({ title: "Envois en attente", description: reconnectMessage(count) });
  } catch (err) {
    clientLogger.warn("Comptage des envois gardés impossible", { err });
  }
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

/**
 * Branche le rejeu à la connexion et la mise à jour entre onglets. Idempotent : le
 * composant racine rappelle `setupOfflinePersistence` à chaque navigation.
 */
export function startOfflineQueueRuntime(): () => void {
  const unsubscribeUser = subscribeActiveOfflineUser((userId) => {
    awaitingReconnect = false;
    scheduleRefresh();
    // Rejeu « à la connexion » : on est probablement en ligne, `replayOfflineQueue` le vérifie.
    if (userId !== null) void replayOfflineQueue({ ignoreBackoff: true });
  });
  const unsubscribeChannel = sessionChannel.subscribe((message) => {
    if (message.type === "queue-changed") scheduleRefresh();
  });
  scheduleRefresh();
  return () => {
    unsubscribeUser();
    unsubscribeChannel();
  };
}

/** Rejeu déclenché par l'événement `online` : toujours suivi de la levée de la barrière du resync. */
export async function replayOnReconnect(): Promise<void> {
  try {
    await replayOfflineQueue({ ignoreBackoff: true });
  } finally {
    releaseReplayGate();
  }
}
