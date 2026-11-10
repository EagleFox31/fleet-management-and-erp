import { IDEMPOTENCY_KEY_PATTERN, IDEMPOTENCY_RETENTION_DAYS, IDEMPOTENCY_STALE_SECONDS } from "@shared/idempotency-routes";
import { clientLogger } from "@/lib/logger";
import type { OfflineActionDefinition } from "@/lib/offline-action-registry";

/**
 * Cœur de la file d'écritures différées hors ligne (v2). Logique pure : le stockage, le
 * réseau, les verrous, l'horloge et les invalidations sont injectés, donc testables en mémoire.
 * Générique : aucun `if` par type d'action ni par rôle (le registre décrit chaque type).
 *
 * Garanties :
 * - la clé d'idempotence est créée à la mise en file, stockée, et jamais régénérée ;
 * - rejeu FIFO strict, arrêt au premier échec réessayable ;
 * - un élément n'est supprimé qu'après un 2xx confirmé (ou une réponse rejouée) ;
 * - un refus définitif (4xx) passe en `rejected`, n'est jamais rejoué ni supprimé en silence ;
 * - aucun rejeu si le compte connecté n'est pas le propriétaire de la file ;
 * - une purge ou un changement de compte pendant le rejeu annule toute écriture.
 */

export type QueueEntryState = "pending" | "sending" | "rejected";
export type QueueMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface QueueEntry {
  id: string;
  type: string;
  /** UUID créé à la mise en file, envoyé en `Idempotency-Key` à chaque rejeu. */
  idempotencyKey: string;
  kind: "json" | "multipart";
  endpoint: string;
  method: QueueMethod;
  payload: unknown;
  /** Identifiants des fichiers stockés à part (magasin `files`, lot V5b-5). */
  fileRefs: string[];
  missionId?: number;
  state: QueueEntryState;
  attempts: number;
  /** Message pour l'utilisateur uniquement, jamais un détail technique. */
  lastError?: string;
  /** Pas de nouvelle tentative automatique avant cet instant (attente exponentielle). */
  nextAttemptAt?: number;
  /** Nombre de réponses « clé en cours » (409) reçues : au-delà du plafond, l'envoi passe « À revoir ». */
  inProgressHits?: number;
  createdAt: number;
  ownerUserId: number;
  label: string;
}

/** Vue publique d'un envoi (sans la charge utile). */
export type QueueEntryView = Omit<QueueEntry, "payload">;

export type SendOutcome =
  | { ok: true; replayed: boolean }
  | { ok: false; status?: number; code?: string; message: string };

export type ResponseClass = "done" | "in-progress" | "retry" | "auth" | "rejected";

export const IN_PROGRESS_CODE = "IDEMPOTENCY_IN_PROGRESS";
/** 409 : la session n'est plus celle du propriétaire de l'envoi (autre compte connecté dans un autre onglet). */
export const OWNER_MISMATCH_CODE = "OFFLINE_OWNER_MISMATCH";

/** Classement d'une réponse (plan V5b section 3). Le statut absent désigne une panne réseau. */
export function classifyOutcome(outcome: SendOutcome): ResponseClass {
  if (outcome.ok) return "done";
  const { status, code } = outcome;
  if (status === undefined) return "retry";
  if (status === 401) return "auth";
  // Compte changé dans un autre onglet : même traitement qu'une session refusée (arrêt, file gardée).
  if (status === 409 && code === OWNER_MISMATCH_CODE) return "auth";
  if (status === 409 && code === IN_PROGRESS_CODE) return "in-progress";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  if (status >= 400) return "rejected";
  return "retry";
}

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const IN_PROGRESS_DELAY_MS = 5_000;
/** Marge au-delà du délai de reprise serveur (`IDEMPOTENCY_STALE_SECONDS`) avant de déclarer À revoir. */
export const IN_PROGRESS_MARGIN_MS = 60_000;
/** Réponses « en cours » tolérées par envoi (délai de reprise serveur plus une marge) avant de le passer « À revoir ». */
export const MAX_IN_PROGRESS_HITS = Math.ceil((IDEMPOTENCY_STALE_SECONDS * 1000 + IN_PROGRESS_MARGIN_MS) / IN_PROGRESS_DELAY_MS);
/** Un jour de marge sous la conservation des clés côté serveur (`IDEMPOTENCY_RETENTION_DAYS`). */
export const MAX_ENTRY_AGE_MS = (IDEMPOTENCY_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000;

export const NOT_REPLAYABLE_MESSAGE =
  "Cet envoi ne peut pas être renvoyé automatiquement sans risque de doublon. Vérifiez-le, puis refaites-le si besoin.";
export const TOO_OLD_MESSAGE =
  "Cet envoi date de trop longtemps pour être renvoyé sans risque de doublon. Vérifiez-le, puis refaites-le si besoin.";
export const STILL_IN_PROGRESS_MESSAGE =
  "Le serveur n'a pas pu confirmer cet envoi. Vérifiez-le avant de le refaire pour éviter un doublon.";

/** Attente avant la tentative suivante : 2 s, 4 s, 8 s... plafonnée à 5 minutes. */
export function backoffDelay(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts, 30) - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

const METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Lit un élément stocké, ancien format compris. L'ancienne file n'avait ni clé
 * d'idempotence ni état : une clé est créée et l'élément reprend en `pending`.
 * Renvoie `changed` quand l'élément a dû être complété (à réécrire).
 */
export function normalizeEntry(
  raw: unknown,
  ownerUserId: number,
  deps: { uuid: () => string; now: () => number },
): { entry: QueueEntry; changed: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.endpoint !== "string" || typeof r.method !== "string" || !METHODS.includes(r.method)) return null;

  let changed = false;
  const take = <T>(value: T | undefined, fallback: T): T => {
    if (value === undefined) {
      changed = true;
      return fallback;
    }
    return value;
  };

  const state: QueueEntryState =
    r.state === "pending" || r.state === "sending" || r.state === "rejected" ? r.state : "pending";
  if (state !== r.state) changed = true;
  const type = typeof r.type === "string" ? r.type : "unknown";
  const entry: QueueEntry = {
    id: typeof r.id === "string" ? r.id : take(undefined, `offline-${deps.now()}-${deps.uuid().slice(0, 8)}`),
    type,
    idempotencyKey: typeof r.idempotencyKey === "string" && r.idempotencyKey ? r.idempotencyKey : take(undefined, deps.uuid()),
    kind: r.kind === "multipart" ? "multipart" : take(r.kind === "json" ? "json" : undefined, "json" as const),
    endpoint: r.endpoint,
    method: r.method as QueueMethod,
    payload: r.payload,
    fileRefs: Array.isArray(r.fileRefs) ? r.fileRefs.filter((f): f is string => typeof f === "string") : take(undefined, []),
    missionId: typeof r.missionId === "number" ? r.missionId : undefined,
    state,
    attempts: typeof r.attempts === "number" ? r.attempts : take(undefined, 0),
    lastError: typeof r.lastError === "string" ? r.lastError : undefined,
    nextAttemptAt: typeof r.nextAttemptAt === "number" ? r.nextAttemptAt : undefined,
    inProgressHits: typeof r.inProgressHits === "number" ? r.inProgressHits : undefined,
    createdAt:
      typeof r.createdAt === "number" && Number.isFinite(r.createdAt) && r.createdAt > 0
        ? r.createdAt
        : take(undefined, deps.now()),
    ownerUserId: typeof r.ownerUserId === "number" ? r.ownerUserId : take(undefined, ownerUserId),
    label: typeof r.label === "string" ? r.label : take(undefined, type),
  };
  return { entry, changed };
}

export interface QueueStore {
  read(userId: number): Promise<unknown[]>;
  /** Faux si la base a été purgée depuis `epoch` (rien n'est écrit). */
  write(userId: number, entries: QueueEntry[], epoch: number): Promise<boolean>;
  epochOf(userId: number): number;
}

export type OwnerCheck = { kind: "user"; id: number } | { kind: "unauthorized" } | { kind: "unreachable" };

export interface OfflineQueueDeps {
  store: QueueStore;
  getActiveUserId: () => number | null;
  /** Envoie l'élément avec sa clé stockée. Ne lève jamais : renvoie le résultat classable. */
  send: (entry: QueueEntry) => Promise<SendOutcome>;
  /** Appelle `/api/auth/me` : à qui appartient la session du navigateur. */
  checkOwner: () => Promise<OwnerCheck>;
  /** Exclusion avec attente pour lire-modifier-écrire la file (entre onglets). */
  withMutationLock: <T>(userId: number, fn: () => Promise<T>) => Promise<T>;
  /** Exclusion sans attente : un seul onglet rejoue. */
  tryReplayLock: <T>(
    userId: number,
    fn: (renew: () => void) => Promise<T>,
  ) => Promise<{ acquired: false } | { acquired: true; value: T }>;
  getDefinition: (type: string) => OfflineActionDefinition | undefined;
  /**
   * Vrai si la route de l'envoi est protégée contre le doublon (clé d'idempotence côté serveur).
   * Sinon l'envoi n'est jamais rejoué automatiquement : il passe « À revoir ».
   */
  isAutoReplayable: (entry: QueueEntry) => boolean;
  /** Invalide les requêtes du type après un envoi confirmé. */
  invalidateFor: (entry: QueueEntry) => void;
  /** Appelé une fois, quand plus aucun envoi n'attend (après au moins un envoi réussi). */
  onDrained: () => void;
  /** Appelé quand la session est refusée (401) : file gardée, `count` envois à renvoyer. */
  onAuthStopped?: (count: number) => void;
  /** Prévient les autres onglets que la file a changé. */
  announceChange?: () => void;
  now: () => number;
  uuid: () => string;
}

export class OfflineQueueError extends Error {
  constructor(
    readonly reason: "no-user" | "session-changed" | "unknown-type" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "OfflineQueueError";
  }
}

export interface EnqueueInput {
  type: string;
  payload: unknown;
  endpoint?: string;
  method?: QueueMethod;
  missionId?: number;
  kind?: "json" | "multipart";
  fileRefs?: string[];
  label?: string;
  /** Clé imposée (le plein réutilise sa `requestKey`) ; sinon un UUID est créé. */
  idempotencyKey?: string;
}

export interface ReplayOptions {
  /** Ignore l'attente exponentielle (retour du réseau, bouton manuel). */
  ignoreBackoff?: boolean;
}

export type ReplayResult =
  | { status: "skipped"; reason: "no-user" | "locked" | "empty" | "other-account" }
  | {
      status: "drained" | "stopped";
      /** Cause de l'arrêt : réessai planifié, session refusée, réseau injoignable, session changée. */
      reason?: "retry" | "auth" | "unreachable" | "session-changed";
      sent: number;
      rejected: number;
      remaining: number;
      /** Instant du prochain réessai automatique, s'il y en a un. */
      nextAttemptAt?: number;
    };

export function createOfflineQueue(deps: OfflineQueueDeps) {
  const normalizeDeps = { uuid: deps.uuid, now: deps.now };

  async function readEntries(userId: number): Promise<QueueEntry[]> {
    const raw = await deps.store.read(userId);
    const entries: QueueEntry[] = [];
    let changed = false;
    for (const item of raw) {
      const normalized = normalizeEntry(item, userId, normalizeDeps);
      if (!normalized) {
        changed = true;
        continue;
      }
      if (normalized.changed) changed = true;
      entries.push(normalized.entry);
    }
    if (changed) {
      // Migration de l'ancien format : les clés créées sont stockées, donc stables au prochain rejeu.
      // `mutate` relit et normalise sous verrou : on réécrit la file telle que normalisée.
      await mutate(userId, (current) => current);
      return (await deps.store.read(userId))
        .map((e) => normalizeEntry(e, userId, normalizeDeps)?.entry ?? null)
        .filter((e): e is QueueEntry => e !== null);
    }
    return entries;
  }

  /**
   * Lit-modifie-écrit la file sous verrou. `fn` reçoit la file courante (déjà normalisée) et
   * renvoie la nouvelle, ou `null` pour ne rien écrire. Faux si la base a été purgée entre-temps.
   */
  async function mutate(userId: number, fn: (current: QueueEntry[] | null) => QueueEntry[] | null): Promise<boolean> {
    return deps.withMutationLock(userId, async () => {
      const epoch = deps.store.epochOf(userId);
      const current = (await deps.store.read(userId))
        .map((e) => normalizeEntry(e, userId, normalizeDeps)?.entry ?? null)
        .filter((e): e is QueueEntry => e !== null);
      const next = fn(current);
      if (next === null) return true;
      if (deps.getActiveUserId() !== userId) return false;
      const saved = await deps.store.write(userId, next, epoch);
      if (saved) deps.announceChange?.();
      return saved;
    });
  }

  async function enqueue(input: EnqueueInput): Promise<QueueEntry> {
    const userId = deps.getActiveUserId();
    if (userId === null) throw new OfflineQueueError("no-user", "Aucun utilisateur connecté");
    const definition = deps.getDefinition(input.type);
    if (!definition) throw new OfflineQueueError("unknown-type", "Type d'envoi inconnu");

    const missionId = input.missionId;
    const endpoint = input.endpoint ?? definition.endpoint?.({ missionId, payload: input.payload });
    if (!endpoint) throw new OfflineQueueError("unknown-type", "Route d'envoi manquante");
    // Une écriture différée ne vise que l'API de l'application, jamais une autre origine.
    if (!endpoint.startsWith("/api/")) throw new OfflineQueueError("invalid", "Route d'envoi invalide");
    const idempotencyKey = input.idempotencyKey ?? deps.uuid();
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new OfflineQueueError("invalid", "Clé d'envoi invalide");

    const entry: QueueEntry = {
      id: `offline-${deps.now()}-${deps.uuid().slice(0, 8)}`,
      type: input.type,
      idempotencyKey,
      kind: input.kind ?? "json",
      endpoint,
      method: input.method ?? definition.method,
      payload: input.payload,
      fileRefs: input.fileRefs ?? [],
      missionId,
      state: "pending",
      attempts: 0,
      createdAt: deps.now(),
      ownerUserId: userId,
      label: input.label ?? definition.label,
    };
    const saved = await mutate(userId, (current) => [...(current ?? []), entry]);
    if (!saved) throw new OfflineQueueError("session-changed", "La session a changé pendant l'enregistrement");
    return entry;
  }

  async function list(userId: number): Promise<QueueEntry[]> {
    return readEntries(userId);
  }

  function countOf(entries: QueueEntry[]) {
    return {
      pending: entries.filter((e) => e.state === "pending").length,
      sending: entries.filter((e) => e.state === "sending").length,
      rejected: entries.filter((e) => e.state === "rejected").length,
    };
  }

  /** Supprime un envoi précis (« Supprimer » sur un élément à revoir). Jamais appelé en silence. */
  async function discard(userId: number, id: string): Promise<boolean> {
    return mutate(userId, (current) => (current ?? []).filter((e) => e.id !== id));
  }

  /** Remet un élément « À revoir » en attente, avec la MÊME clé (nouvelle tentative explicite). */
  async function retryRejected(userId: number, id: string): Promise<boolean> {
    return mutate(userId, (current) =>
      (current ?? []).map((e) =>
        e.id === id && e.state === "rejected"
          ? { ...e, state: "pending" as const, lastError: undefined, nextAttemptAt: undefined, inProgressHits: undefined }
          : e,
      ),
    );
  }

  async function replay(options: ReplayOptions = {}): Promise<ReplayResult> {
    const userId = deps.getActiveUserId();
    if (userId === null) return { status: "skipped", reason: "no-user" };
    const locked = await deps.tryReplayLock(userId, (renew) => runReplay(userId, options, renew));
    if (!locked.acquired) return { status: "skipped", reason: "locked" };
    return locked.value;
  }

  async function runReplay(userId: number, options: ReplayOptions, renew: () => void): Promise<ReplayResult> {
    const startEpoch = deps.store.epochOf(userId);
    const aborted = () => deps.getActiveUserId() !== userId || deps.store.epochOf(userId) !== startEpoch;

    const initial = await readEntries(userId);
    if (!initial.some((e) => e.state !== "rejected")) return { status: "skipped", reason: "empty" };

    // Réserve S1 : la session du navigateur doit être celle du propriétaire de la file.
    const owner = await deps.checkOwner();
    if (owner.kind === "unauthorized") {
      deps.onAuthStopped?.(initial.filter((e) => e.state !== "rejected").length);
      return { status: "stopped", reason: "auth", sent: 0, rejected: 0, remaining: initial.length };
    }
    if (owner.kind === "unreachable") {
      return { status: "stopped", reason: "unreachable", sent: 0, rejected: 0, remaining: initial.length };
    }
    if (owner.id !== userId) {
      clientLogger.warn("File hors ligne gardée : la session ouverte n'est pas celle de son propriétaire");
      return { status: "skipped", reason: "other-account" };
    }
    if (aborted()) return { status: "stopped", reason: "session-changed", sent: 0, rejected: 0, remaining: initial.length };

    let sent = 0;
    let rejected = 0;
    const summary = async (
      status: "drained" | "stopped",
      reason?: "retry" | "auth" | "session-changed",
      nextAttemptAt?: number,
    ): Promise<ReplayResult> => {
      const remaining = aborted() ? 0 : (await readEntries(userId)).length;
      return { status, reason, sent, rejected, remaining, nextAttemptAt };
    };

    for (;;) {
      renew();
      if (aborted()) return summary("stopped", "session-changed");
      const entries = await readEntries(userId);
      // Un élément « À revoir » ne bloque pas les suivants ; un élément réessayable, si.
      const next = entries.find((e) => e.state !== "rejected");
      if (!next) break;

      if (!options.ignoreBackoff && next.nextAttemptAt !== undefined && next.nextAttemptAt > deps.now()) {
        return summary("stopped", "retry", next.nextAttemptAt);
      }

      // Garde-fous avant tout envoi : jamais rejouer une route non protégée ni une clé qui a pu expirer.
      const refusal = !deps.isAutoReplayable(next)
        ? NOT_REPLAYABLE_MESSAGE
        : deps.now() - next.createdAt > MAX_ENTRY_AGE_MS
          ? TOO_OLD_MESSAGE
          : null;
      if (refusal !== null) {
        await mutate(userId, (current) =>
          (current ?? []).map((e) =>
            e.id === next.id ? { ...e, state: "rejected" as const, lastError: refusal, nextAttemptAt: undefined } : e,
          ),
        );
        rejected++;
        continue;
      }

      const marked = await mutate(userId, (current) =>
        (current ?? []).map((e) => (e.id === next.id ? { ...e, state: "sending" as const, attempts: e.attempts + 1 } : e)),
      );
      if (!marked || aborted()) return summary("stopped", "session-changed");

      const outcome = await deps.send({ ...next, state: "sending", attempts: next.attempts + 1 });
      // Déconnexion ou changement de compte pendant l'envoi : rien n'est écrit.
      if (aborted()) return summary("stopped", "session-changed");

      switch (classifyOutcome(outcome)) {
        case "done": {
          await mutate(userId, (current) => (current ?? []).filter((e) => e.id !== next.id));
          sent++;
          if (!aborted()) deps.invalidateFor(next);
          break;
        }
        case "rejected": {
          const message = outcome.ok ? "" : outcome.message;
          await mutate(userId, (current) =>
            (current ?? []).map((e) =>
              e.id === next.id ? { ...e, state: "rejected" as const, lastError: message, nextAttemptAt: undefined } : e,
            ),
          );
          rejected++;
          break;
        }
        case "auth": {
          await mutate(userId, (current) =>
            (current ?? []).map((e) => (e.id === next.id ? { ...e, state: "pending" as const } : e)),
          );
          const waiting = (await readEntries(userId)).filter((e) => e.state !== "rejected").length;
          deps.onAuthStopped?.(waiting);
          return summary("stopped", "auth");
        }
        case "in-progress":
        case "retry": {
          const inProgress = classifyOutcome(outcome) === "in-progress";
          const hits = (next.inProgressHits ?? 0) + (inProgress ? 1 : 0);
          if (inProgress && hits >= MAX_IN_PROGRESS_HITS) {
            // Une clé jamais libérée (stock, panne) ne se résout pas toute seule : un humain tranche.
            await mutate(userId, (current) =>
              (current ?? []).map((e) =>
                e.id === next.id
                  ? { ...e, state: "rejected" as const, lastError: STILL_IN_PROGRESS_MESSAGE, nextAttemptAt: undefined, inProgressHits: hits }
                  : e,
              ),
            );
            rejected++;
            break;
          }
          const delay = inProgress ? IN_PROGRESS_DELAY_MS : backoffDelay(next.attempts + 1);
          const at = deps.now() + delay;
          const message = outcome.ok ? "" : outcome.message;
          await mutate(userId, (current) =>
            (current ?? []).map((e) =>
              e.id === next.id ? { ...e, state: "pending" as const, lastError: message, nextAttemptAt: at, inProgressHits: hits } : e,
            ),
          );
          return summary("stopped", "retry", at);
        }
      }
    }

    const result = await summary("drained");
    if (sent > 0 && !aborted()) deps.onDrained();
    return result;
  }

  return { enqueue, list, replay, discard, retryRejected, countOf, mutate };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;

// ---------------------------------------------------------------------------
// Messages affichés (français, sans jargon)
// ---------------------------------------------------------------------------

/** Toast après une mise en file : jamais « enregistré » avant le 2xx du serveur. */
export const OFFLINE_QUEUED_MESSAGE = "Enregistré sur le téléphone, envoi au retour du réseau";

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

/** Session expirée avec des envois gardés. */
export function reconnectMessage(count: number): string {
  return `Reconnectez-vous pour envoyer ${count} ${plural(count, "élément", "éléments")}`;
}

/** Libellé du choix explicite de déconnexion avec des envois non partis. */
export function discardSendsLabel(count: number): string {
  return `Supprimer ${count} ${plural(count, "envoi", "envois")}`;
}

/** Texte du blocage de déconnexion. */
export function logoutBlockedMessage(count: number): string {
  return `${count} ${plural(count, "envoi n'est pas encore parti", "envois ne sont pas encore partis")}. Se déconnecter les supprimerait définitivement.`;
}
