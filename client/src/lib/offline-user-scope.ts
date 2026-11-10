/**
 * Cloison du stockage hors ligne par utilisateur.
 *
 * Logique pure : aucun accès à IndexedDB, au QueryClient ni au réseau. Le
 * stockage réel est injecté (`OfflineKv`), ce qui permet de la tester en
 * mémoire. L'implémentation idb-keyval est dans `offline-storage.ts`.
 *
 * Règles :
 * - une base IndexedDB par utilisateur (`fleetos-offline-u<id>`) ; aucune clé
 *   globale partagée entre comptes ;
 * - seules les requêtes de la liste blanche sont persistées (mes OT, et le
 *   véhicule, le détail et les pièces de ces OT) ;
 * - l'enveloppe porte l'identifiant de son propriétaire et est refusée à la
 *   lecture si elle ne correspond pas à l'utilisateur actif ;
 * - une purge invalide les écritures en cours (`epoch`) : une sauvegarde
 *   lancée avant la déconnexion ne ressuscite pas le magasin purgé.
 *
 * L'utilisateur actif est un état partagé : importer ce module par l'alias
 * `@/lib/offline-user-scope`, jamais par chemin relatif (AGENTS.md §2).
 */

import { clientLogger } from "@/lib/logger";
import { DRIVER_ME_SHAPE, FUEL_CARD_BALANCE_SHAPE, pickFields } from "@/lib/offline-driver-projection";

export const OFFLINE_DB_PREFIX = "fleetos-offline-u";
export const OFFLINE_SCHEMA_VERSION = 2;
export const CACHE_RECORD_KEY = "query-cache";
export const QUEUE_RECORD_KEY = "queue";
/**
 * Préfixe des enregistrements de fichiers en attente d'envoi (Blob), dans la même base
 * par compte que la file. Réservé : rien n'est écrit avant le lot V5b-5 (photos POD).
 * Une purge de la base les emporte avec la file.
 */
export const FILES_RECORD_PREFIX = "files:";
/** Clés globales de l'ancien format (store par défaut d'idb-keyval), à détruire. */
export const LEGACY_RECORD_KEYS = ["fleetos-query-cache-v1", "fleetos-offline-queue-v1"] as const;
/** Une copie plus ancienne est jetée à la lecture. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Âge maximal d'un cache de lecture contenant des données du chauffeur (mission, pleins, fiche). */
export const DRIVER_CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export function offlineDbName(userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Identifiant utilisateur invalide pour le stockage hors ligne");
  }
  return `${OFFLINE_DB_PREFIX}${userId}`;
}

export function isOfflineDbName(name: string | undefined | null): name is string {
  return typeof name === "string" && /^fleetos-offline-u\d+$/.test(name);
}

/**
 * Registre des bases créées, dans une clé fixe du stockage local. Les navigateurs
 * sans `indexedDB.databases()` (Firefox avant 126) ne peuvent pas énumérer les
 * bases d'autres comptes : sans ce registre, leurs magasins ne seraient jamais
 * vidés. Il ne contient que des noms de base (`fleetos-offline-u<id>`), aucune donnée.
 */
export const OFFLINE_DB_REGISTRY_KEY = "fleetos-offline-db-registry";

export function createDbRegistry(storage: () => Pick<Storage, "getItem" | "setItem"> | null) {
  function read(): string[] {
    try {
      const raw = storage()?.getItem(OFFLINE_DB_REGISTRY_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isOfflineDbName) : [];
    } catch {
      return [];
    }
  }
  return {
    list: read,
    remove(name: string): void {
      try {
        const known = read();
        if (!known.includes(name)) return;
        storage()?.setItem(OFFLINE_DB_REGISTRY_KEY, JSON.stringify(known.filter((n) => n !== name)));
      } catch (err) {
        clientLogger.warn("Registre des magasins hors ligne non mis à jour", { err, name });
      }
    },
    add(name: string): void {
      if (!isOfflineDbName(name)) return;
      try {
        const known = read();
        if (known.includes(name)) return;
        storage()?.setItem(OFFLINE_DB_REGISTRY_KEY, JSON.stringify([...known, name]));
      } catch (err) {
        clientLogger.warn("Registre des magasins hors ligne non mis à jour", { err, name });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Utilisateur actif
// ---------------------------------------------------------------------------

type ActiveUserListener = (userId: number | null, previous: number | null) => void;

interface ActiveUserState {
  userId: number | null;
  listeners: Set<ActiveUserListener>;
}

// Porté par globalThis : une seconde instance du module (import relatif, HMR)
// lirait sinon un autre utilisateur actif que celui qui écrit.
const STATE_KEY = Symbol.for("fleetos.offline-active-user");
const holder = globalThis as unknown as Record<symbol, ActiveUserState | undefined>;
const state: ActiveUserState = (holder[STATE_KEY] ??= { userId: null, listeners: new Set() });

export function getActiveOfflineUserId(): number | null {
  return state.userId;
}

/** Retourne l'utilisateur précédent et si l'utilisateur actif a changé. */
export function setActiveOfflineUserId(userId: number | null): { previous: number | null; changed: boolean } {
  const previous = state.userId;
  if (previous === userId) return { previous, changed: false };
  state.userId = userId;
  for (const listener of Array.from(state.listeners)) {
    try {
      listener(userId, previous);
    } catch (err) {
      clientLogger.error("Écouteur d'utilisateur hors ligne en échec", { err });
    }
  }
  return { previous, changed: true };
}

export function subscribeActiveOfflineUser(listener: ActiveUserListener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Liste blanche des requêtes persistées
// ---------------------------------------------------------------------------

export const MY_WORK_ORDERS_PATH = "/api/technician/my-work-orders";

const WORK_ORDER_PATH = /^\/api\/work-orders\/(\d+)(?:\/(parts|pending-part-requirements|items))?$/;
const VEHICLE_PATH = /^\/api\/vehicles\/(\d+)$/;

export interface CachedQueryLike {
  queryKey: readonly unknown[];
  state: { data?: unknown; status?: string; dataUpdatedAt?: number };
}

function myWorkOrdersOf(data: unknown): Array<{ id: number; vehicleId: number | null }> {
  const raw = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { workOrders?: unknown }).workOrders)
      ? (data as { workOrders: unknown[] }).workOrders
      : [];
  const result: Array<{ id: number; vehicleId: number | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = Number((item as { id?: unknown }).id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const vehicleId = Number((item as { vehicleId?: unknown }).vehicleId);
    result.push({ id, vehicleId: Number.isInteger(vehicleId) && vehicleId > 0 ? vehicleId : null });
  }
  return result;
}

/**
 * Ne garde que ce dont un technicien a besoin hors ligne : la liste de ses OT,
 * puis, pour ces OT seulement, le détail, les lignes, les pièces, les demandes
 * de pièce en attente et le véhicule. Une requête avec paramètres, en erreur ou
 * sans donnée n'est jamais retenue. Tout le reste (catalogue de pièces,
 * tableaux de bord, factures, autres OT) est exclu.
 */
export function selectTechnicianQueries<T extends CachedQueryLike>(queries: readonly T[]): T[] {
  const mine = queries.find(
    (q) => q.queryKey.length === 1 && q.queryKey[0] === MY_WORK_ORDERS_PATH && q.state.status === "success",
  );
  if (!mine || mine.state.data === undefined) return [];

  const owned = myWorkOrdersOf(mine.state.data);
  const workOrderIds = new Set(owned.map((o) => o.id));
  const vehicleIds = new Set(owned.flatMap((o) => (o.vehicleId === null ? [] : [o.vehicleId])));

  return queries.filter((q) => {
    if (q.state.status !== "success" || q.state.data === undefined) return false;
    if (q.queryKey.length !== 1 || typeof q.queryKey[0] !== "string") return false;
    const path = q.queryKey[0];
    if (path === MY_WORK_ORDERS_PATH) return true;
    const workOrder = WORK_ORDER_PATH.exec(path);
    if (workOrder) return workOrderIds.has(Number(workOrder[1]));
    const vehicle = VEHICLE_PATH.exec(path);
    if (vehicle) return vehicleIds.has(Number(vehicle[1]));
    return false;
  });
}

// ---------------------------------------------------------------------------
// Profils de lecture hors ligne (une table, aucun `if role`)
// ---------------------------------------------------------------------------

/** Statuts de mission lisibles hors ligne pour un chauffeur (décision 3 de V5b). */
export const DRIVER_OFFLINE_MISSION_STATUSES: readonly string[] = ["in_progress", "delivered"];

export const DRIVER_ME_PATH = "/api/drivers/me";
export const FUEL_CARD_BALANCE_PATH = "/api/fuel-card/balance";
type FlagReader = (flag: string) => boolean;

/**
 * Un profil dit quelles requêtes sont gardées et sous quels drapeaux. L'ancre (la
 * requête qui prouve à qui appartient le cache) vient des données du compte, jamais
 * de l'URL : sans ancre valide, le profil ne retient rien.
 */
export interface OfflineReadProfile {
  id: string;
  /** Drapeaux qui doivent tous être allumés ; aucun = toujours actif. */
  flags: readonly string[];
  /** Rôles servis par ce profil. */
  roles: readonly string[];
  /**
   * Vrai : l'appareil peut rouvrir la lecture de ce profil au démarrage sans réseau, sur le
   * marqueur `offline-resume` (voir `offline-resume.ts`). Faux par défaut : opt-in explicite.
   */
  resumeOffline: boolean;
  select<T extends CachedQueryLike>(queries: readonly T[]): T[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Réduction de `/api/drivers/me` à l'identité du chauffeur et à ses missions en cours ou
 * livrées. La fiche complète (permis, CNI, naissance, CPC, matricule) n'est jamais gardée.
 */
export function projectDriverMe(
  data: unknown,
): { driver: { id: number; firstName?: string; lastName?: string }; missions: Record<string, unknown>[] } | null {
  const root = asRecord(data);
  const driver = asRecord(root?.driver);
  const driverId = positiveInt(driver?.id);
  if (!root || !driver || driverId === null || !Array.isArray(root.missions)) return null;
  const missions = root.missions.flatMap((m) => {
    const mission = asRecord(m);
    const id = positiveInt(mission?.id);
    if (!mission || id === null || !DRIVER_OFFLINE_MISSION_STATUSES.includes(String(mission.status))) return [];
    return [mission];
  });
  return pickFields({ driver, missions }, DRIVER_ME_SHAPE) as ReturnType<typeof projectDriverMe>;
}

function withData<T extends CachedQueryLike>(q: T, data: unknown): T {
  return { ...q, state: { ...q.state, data } };
}

export const DRIVER_READ_PROFILE: OfflineReadProfile = {
  id: "driver",
  flags: ["driver-offline", "offline-writes"],
  roles: ["driver"],
  resumeOffline: true,
  select<T extends CachedQueryLike>(queries: readonly T[]): T[] {
    const anchor = queries.find(
      (q) => q.queryKey.length === 1 && q.queryKey[0] === DRIVER_ME_PATH && q.state.status === "success",
    );
    const me = anchor ? projectDriverMe(anchor.state.data) : null;
    if (!anchor || !me) return [];
    const result: T[] = [withData(anchor, me)];
    // Cache <= ecran : le tableau de bord chauffeur ne lit que sa fiche et le prix du litre.
    for (const q of queries) {
      if (q === anchor || q.state.status !== "success" || q.state.data === undefined) continue;
      if (q.queryKey.length === 1 && q.queryKey[0] === FUEL_CARD_BALANCE_PATH) {
        result.push(withData(q, pickFields(q.state.data, FUEL_CARD_BALANCE_SHAPE)));
      }
    }
    return result;
  },
};

export const TECHNICIAN_READ_PROFILE: OfflineReadProfile = {
  id: "technician",
  flags: [],
  roles: ["technician"],
  resumeOffline: false,
  select: selectTechnicianQueries,
};

/** Table des profils : ajouter un profil ici, jamais un test de rôle ailleurs. */
export const OFFLINE_READ_PROFILES: readonly OfflineReadProfile[] = [TECHNICIAN_READ_PROFILE, DRIVER_READ_PROFILE];

/**
 * Requêtes à persister : union des profils actifs. Sans lecteur de drapeaux, seuls les
 * profils sans drapeau (technicien) sont actifs, donc rien ne change drapeaux éteints.
 */
export function selectPersistableQueries<T extends CachedQueryLike>(
  queries: readonly T[],
  isFlagOn: FlagReader = () => false,
): T[] {
  const picked = new Set<T>();
  const ordered: T[] = [];
  for (const profile of OFFLINE_READ_PROFILES) {
    if (!profile.flags.every((flag) => isFlagOn(flag))) continue;
    for (const q of profile.select(queries)) {
      if (picked.has(q)) continue;
      picked.add(q);
      ordered.push(q);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Magasin cloisonné
// ---------------------------------------------------------------------------

/** Stockage clé/valeur injecté : une base nommée par utilisateur. */
export interface OfflineKv {
  get<T>(db: string, key: string): Promise<T | undefined>;
  set(db: string, key: string, value: unknown): Promise<void>;
  del(db: string, key: string): Promise<void>;
  /** Vide la base nommée (elle reste, sans enregistrement). */
  clearDb(db: string): Promise<void>;
  /** Supprime la base vidée (et son entrée du registre), pour ne pas laisser de base vide par compte. Facultatif, au mieux. */
  dropDb?(db: string): Promise<void>;
  /** Noms des bases `fleetos-offline-u*` connues du navigateur. */
  listDbs(): Promise<string[]>;
  /** Supprime une clé du store par défaut (ancien format global). */
  delLegacy(key: string): Promise<void>;
}

export interface PersistedQuery {
  queryKey: readonly unknown[];
  state: { data: unknown; dataUpdatedAt?: number };
}

interface CacheEnvelope {
  version: number;
  userId: number;
  timestamp: number;
  queries: PersistedQuery[];
}

interface QueueEnvelope<T> {
  version: number;
  userId: number;
  actions: T[];
}

/** Envois détruits par une purge : décompte et types seulement, jamais de contenu ni d'identifiant. */
export interface QueueLoss {
  count: number;
  types: Record<string, number>;
}

export function createOfflineScope(kv: OfflineKv) {
  // Une purge d'un magasin incrémente son compteur : toute écriture démarrée
  // avant lui s'annule au lieu de ressusciter les données purgées.
  const epochs = new Map<string, number>();
  const epochOfDb = (db: string) => epochs.get(db) ?? 0;

  async function clearDb(db: string): Promise<void> {
    epochs.set(db, epochOfDb(db) + 1);
    try {
      await kv.clearDb(db);
    } catch (err) {
      clientLogger.warn("Échec de purge d'un magasin hors ligne", { err, db });
      return;
    }
    try {
      await kv.dropDb?.(db);
    } catch (err) {
      clientLogger.warn("Suppression d'un magasin hors ligne vidé impossible", { err, db });
    }
  }

  /** Supprime le seul cache de lecture d'un magasin ; une sauvegarde en cours s'annule. */
  async function dropReadCache(db: string): Promise<void> {
    epochs.set(db, epochOfDb(db) + 1);
    try {
      await kv.del(db, CACHE_RECORD_KEY);
    } catch (err) {
      clientLogger.warn("Échec de purge d'un cache hors ligne", { err, db });
    }
  }

  // Compteur propre au cache de lecture : l'abandonner ne touche pas la file d'écritures.
  const cacheEpochs = new Map<string, number>();
  const cacheEpochOfDb = (db: string) => cacheEpochs.get(db) ?? 0;

  async function dropReadCacheOnly(db: string): Promise<void> {
    cacheEpochs.set(db, cacheEpochOfDb(db) + 1);
    try {
      await kv.del(db, CACHE_RECORD_KEY);
    } catch (err) {
      clientLogger.warn("Échec de purge d'un cache hors ligne", { err, db });
    }
  }

  async function countQueued(db: string): Promise<number> {
    try {
      const saved = await kv.get<QueueEnvelope<unknown>>(db, QUEUE_RECORD_KEY);
      return saved && Array.isArray(saved.actions) ? saved.actions.length : 0;
    } catch {
      return 0;
    }
  }

  /** Nombre d'envois d'un magasin et répartition par type d'écriture (clé du registre), sans contenu. */
  async function summarizeQueued(db: string): Promise<QueueLoss> {
    try {
      const saved = await kv.get<QueueEnvelope<unknown>>(db, QUEUE_RECORD_KEY);
      const actions = saved && Array.isArray(saved.actions) ? saved.actions : [];
      const types: Record<string, number> = {};
      for (const action of actions) {
        const type =
          action && typeof action === "object" && typeof (action as { type?: unknown }).type === "string"
            ? (action as { type: string }).type.slice(0, 64)
            : "inconnu";
        types[type] = (types[type] ?? 0) + 1;
      }
      return { count: actions.length, types };
    } catch {
      return { count: 0, types: {} };
    }
  }

  const mergeLoss = (losses: QueueLoss[]): QueueLoss => {
    const types: Record<string, number> = {};
    for (const loss of losses) for (const [type, n] of Object.entries(loss.types)) types[type] = (types[type] ?? 0) + n;
    return { count: losses.reduce((a, l) => a + l.count, 0), types };
  };

  async function listOfflineDbs(): Promise<string[] | null> {
    try {
      return (await kv.listDbs()).filter(isOfflineDbName);
    } catch (err) {
      clientLogger.warn("Énumération des magasins hors ligne impossible", { err });
      return null;
    }
  }

  async function purgeLegacy(): Promise<void> {
    for (const key of LEGACY_RECORD_KEYS) {
      try {
        await kv.delLegacy(key);
      } catch (err) {
        clientLogger.warn("Échec de purge de l'ancien cache hors ligne", { err, key });
      }
    }
  }

  return {
    /** Nombre d'écritures en file (tous états) d'un compte, sans exiger qu'il soit actif. */
    queuedCount: (userId: number) => countQueued(offlineDbName(userId)),

    /** Supprime le seul cache de lecture d'un compte (session expirée) ; sa file d'écritures est gardée. */
    dropUserReadCache: (userId: number) => dropReadCacheOnly(offlineDbName(userId)),

    /** Compteur de purge du magasin d'un utilisateur, à relever avant une écriture asynchrone. */
    epochOf: (userId: number) => epochOfDb(offlineDbName(userId)),

    async saveCache(
      userId: number,
      queries: readonly CachedQueryLike[],
      now = Date.now(),
      isFlagOn?: FlagReader,
      options: { dropIfEmpty?: boolean } = {},
    ): Promise<number> {
      const db = offlineDbName(userId);
      const startedAt = epochOfDb(db);
      const cacheStartedAt = cacheEpochOfDb(db);
      const persistable = selectPersistableQueries(queries, isFlagOn).map((q) => ({
        queryKey: q.queryKey,
        state: { data: q.state.data, dataUpdatedAt: q.state.dataUpdatedAt },
      }));
      // Rien à garder (cache pas encore rempli) : ne pas écraser la copie existante par du vide.
      // Sauf si les drapeaux, connus et éteints, interdisent d'en garder une.
      if (persistable.length === 0) {
        if (options.dropIfEmpty) await dropReadCacheOnly(db);
        return 0;
      }
      const envelope: CacheEnvelope = {
        version: OFFLINE_SCHEMA_VERSION,
        userId,
        timestamp: now,
        queries: persistable,
      };
      await kv.set(db, CACHE_RECORD_KEY, envelope);
      if (epochOfDb(db) === startedAt && cacheEpochOfDb(db) !== cacheStartedAt) {
        await kv.del(db, CACHE_RECORD_KEY);
        return 0;
      }
      if (epochOfDb(db) !== startedAt) {
        await clearDb(db);
        return 0;
      }
      return persistable.length;
    },

    async loadCache(userId: number, now = Date.now(), isFlagOn?: FlagReader): Promise<PersistedQuery[]> {
      const db = offlineDbName(userId);
      const saved = await kv.get<CacheEnvelope>(db, CACHE_RECORD_KEY);
      if (!saved) return [];
      if (saved.version !== OFFLINE_SCHEMA_VERSION || saved.userId !== userId || !Array.isArray(saved.queries)) {
        await kv.del(db, CACHE_RECORD_KEY);
        return [];
      }
      const hasDriverData = Array.isArray(saved.queries) && saved.queries.some((q) => q.queryKey?.[0] === DRIVER_ME_PATH);
      if (now - saved.timestamp > (hasDriverData ? DRIVER_CACHE_MAX_AGE_MS : CACHE_MAX_AGE_MS)) {
        await kv.del(db, CACHE_RECORD_KEY);
        return [];
      }
      // Relecture filtrée : une liste blanche resserrée plus tard s'applique aussi aux copies déjà écrites.
      return selectPersistableQueries(
        saved.queries.map((q) => ({
          queryKey: q.queryKey,
          state: { data: q.state?.data, dataUpdatedAt: q.state?.dataUpdatedAt, status: "success" },
        })),
        isFlagOn,
      ).map((q) => ({
        queryKey: q.queryKey,
        state: { data: q.state.data, dataUpdatedAt: q.state.dataUpdatedAt },
      }));
    },

    async readQueue<T>(userId: number): Promise<T[]> {
      const saved = await kv.get<QueueEnvelope<T>>(offlineDbName(userId), QUEUE_RECORD_KEY);
      if (!saved || saved.version !== OFFLINE_SCHEMA_VERSION || saved.userId !== userId) return [];
      return Array.isArray(saved.actions) ? saved.actions : [];
    },

    /** Écrit la file ; sans effet si le magasin a été purgé depuis `expectedEpoch`. */
    async writeQueue<T>(userId: number, actions: T[], expectedEpoch: number): Promise<boolean> {
      const db = offlineDbName(userId);
      if (expectedEpoch !== epochOfDb(db)) return false;
      const envelope: QueueEnvelope<T> = { version: OFFLINE_SCHEMA_VERSION, userId, actions };
      await kv.set(db, QUEUE_RECORD_KEY, envelope);
      if (expectedEpoch !== epochOfDb(db)) {
        await clearDb(db);
        return false;
      }
      return true;
    },

    /**
     * Déconnexion : le magasin du compte qui se déconnecte est vidé, file comprise ; les
     * autres comptes perdent leur cache de lecture mais gardent leur file (même règle que
     * `purgeOthers` : tablette partagée). L'ancien format global est détruit.
     * Avec `dropOtherQueues`, les magasins des autres comptes sont vidés entièrement, file
     * comprise (décision V5b : purge complète à la déconnexion).
     * Renvoie le nombre d'écritures du compte sortant détruites (journalisé).
     */
    async purgeAll(
      activeUserId: number | null = getActiveOfflineUserId(),
      options: { dropOtherQueues?: boolean } = {},
    ): Promise<number> {
      const own = activeUserId !== null ? offlineDbName(activeUserId) : null;
      const others = ((await listOfflineDbs()) ?? []).filter((name) => name !== own);
      const ownLoss = own ? await summarizeQueued(own) : { count: 0, types: {} };
      const lost = ownLoss.count;
      const lostOthers = options.dropOtherQueues
        ? mergeLoss(await Promise.all(others.map(summarizeQueued)))
        : { count: 0, types: {} };
      await Promise.all([
        ...(own ? [clearDb(own)] : []),
        ...others.map(options.dropOtherQueues ? clearDb : dropReadCache),
      ]);
      await purgeLegacy();
      if (lostOthers.count > 0) {
        clientLogger.warn("Écritures hors ligne d'autres comptes détruites à la déconnexion", {
          lost: lostOthers.count,
          types: lostOthers.types,
        });
      }
      if (lost > 0) {
        clientLogger.warn("Écritures hors ligne non synchronisées détruites à la déconnexion", {
          lost,
          types: ownLoss.types,
        });
      }
      return lost;
    },

    /**
     * Changement d'utilisateur sans déconnexion (tablette partagée) : le cache de lecture
     * des autres comptes est supprimé ; leur file d'écritures est gardée pour leur
     * prochaine connexion, sauf avec `dropQueues` (purge complète, décision V5b).
     * Gardée, elle reste illisible ici : `readQueue` exige le même userId.
     */
    async purgeOthers(keepUserId: number, options: { dropQueues?: boolean } = {}): Promise<number> {
      const keep = offlineDbName(keepUserId);
      const others = ((await listOfflineDbs()) ?? []).filter((name) => name !== keep);
      if (options.dropQueues) {
        const lost = mergeLoss(await Promise.all(others.map(summarizeQueued)));
        if (lost.count > 0) {
          clientLogger.warn("Écritures hors ligne d'un autre compte détruites au changement de compte", {
            lost: lost.count,
            types: lost.types,
          });
        }
      }
      await Promise.all(others.map(options.dropQueues ? clearDb : dropReadCache));
      return others.length;
    },

    purgeLegacy,
  };
}

export type OfflineScope = ReturnType<typeof createOfflineScope>;
