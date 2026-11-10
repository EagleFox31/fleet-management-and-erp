import { OFFLINE_READ_PROFILES, type OfflineReadProfile } from "@/lib/offline-user-scope";

/**
 * Marqueur `offline-resume` : la seule trace persistante de « qui était connecté » sur l'appareil.
 *
 * Sans lui, l'utilisateur actif n'existe qu'en mémoire et un démarrage sans réseau ne restaure
 * rien. Avec lui, un chauffeur dont la dernière connexion en ligne date de moins de 72 h rouvre
 * SA copie de lecture (jamais la file d'envois). Règles :
 * - il ne contient ni jeton, ni cookie, ni identifiant de session, ni email, ni nom : un
 *   identifiant numérique, l'identifiant du profil de lecture, deux horodatages, des drapeaux ;
 * - il vit dans sa propre base (`fleetos-offline-resume`, hors du préfixe des caches de lecture :
 *   aucune purge de cache ne l'emporte par accident, aucune ne le garde par oubli), purgé
 *   explicitement à chaque événement de session ;
 * - son échéance est `dernier contact réseau + 72 h` et n'est JAMAIS repoussée par une lecture ou
 *   un démarrage hors ligne : seul `record` / `touch`, appelés après une réponse réseau réussie,
 *   écrivent ;
 * - il ne prouve pas l'identité : le cookie reste l'unique preuve, `/api/auth/me` revalide au retour
 *   du réseau, et le marqueur est remplacé ou effacé si le compte renvoyé diffère.
 */

export const RESUME_DB = "fleetos-offline-resume";
export const RESUME_KEY = "offline-resume";
export const RESUME_VERSION = 1;
/**
 * Pierre tombale (localStorage) : posée quand la suppression du marqueur échoue (IndexedDB
 * indisponible). Elle ne contient que `{ userId }` (ni jeton ni email), bloque toute restauration
 * et fait retenter la purge au démarrage suivant.
 */
export const RESUME_REVOKED_KEY = "fleetos-offline-resume-revoked";
/** Même durée que la copie de lecture du chauffeur (`DRIVER_CACHE_MAX_AGE_MS`). */
export const RESUME_TTL_MS = 72 * 60 * 60 * 1000;
/** Un dernier contact plus loin dans le futur que ceci trahit une horloge reculée : marqueur refusé. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Sous-ensemble de `OfflineKv` dont le marqueur a besoin. */
export interface ResumeKv {
  get<T>(db: string, key: string): Promise<T | undefined>;
  set(db: string, key: string, value: unknown): Promise<void>;
  del(db: string, key: string): Promise<void>;
}

/** Accès à la pierre tombale ; chaque méthode peut lever (stockage indisponible). */
export interface RevokedStore {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export type FlagSnapshot = Record<string, boolean>;

export interface ResumeMarker {
  version: number;
  userId: number;
  /** Identifiant du profil de lecture (`OfflineReadProfile.id`), pas un rôle. */
  profile: string;
  lastOnlineAt: number;
  expiresAt: number;
  flags: FlagSnapshot;
}

export interface ResumeGrant {
  userId: number;
  profile: string;
  lastOnlineAt: number;
  expiresAt: number;
  /** Lecteur de drapeaux fondé sur le marqueur : hors ligne, le réseau ne peut pas les donner. */
  isFlagOn(flag: string): boolean;
}

/** Profil de lecture qui autorise la reprise pour ce rôle ; aucun test de rôle ailleurs. */
export function resumeProfileOf(
  role: string | undefined | null,
  profiles: readonly OfflineReadProfile[] = OFFLINE_READ_PROFILES,
): OfflineReadProfile | null {
  if (typeof role !== "string") return null;
  return profiles.find((p) => p.resumeOffline && p.roles.includes(role)) ?? null;
}

/** Drapeaux dont le marqueur garde la valeur : ceux des profils de reprise. */
export function resumeFlagNames(profiles: readonly OfflineReadProfile[] = OFFLINE_READ_PROFILES): string[] {
  return Array.from(new Set(profiles.filter((p) => p.resumeOffline).flatMap((p) => p.flags)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Marqueur lisible, sans encore juger de l'échéance, du profil ni des drapeaux. */
function parseMarker(raw: unknown): ResumeMarker | null {
  if (!isRecord(raw) || raw.version !== RESUME_VERSION) return null;
  const { userId, profile, lastOnlineAt, expiresAt, flags } = raw;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return null;
  if (typeof profile !== "string") return null;
  if (typeof lastOnlineAt !== "number" || !Number.isFinite(lastOnlineAt)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  // L'échéance se déduit du dernier contact : une valeur écrite plus loin est une falsification.
  if (expiresAt !== lastOnlineAt + RESUME_TTL_MS) return null;
  if (!isRecord(flags)) return null;
  const clean: FlagSnapshot = {};
  for (const name of resumeFlagNames()) clean[name] = flags[name] === true;
  return { version: RESUME_VERSION, userId, profile, lastOnlineAt, expiresAt, flags: clean };
}

type Verdict = { ok: true; marker: ResumeMarker; profile: OfflineReadProfile } | { ok: false };

function judge(raw: unknown, now: number, profiles: readonly OfflineReadProfile[]): Verdict {
  const marker = parseMarker(raw);
  if (!marker) return { ok: false };
  if (marker.lastOnlineAt > now + CLOCK_SKEW_MS) return { ok: false };
  if (now > marker.expiresAt) return { ok: false };
  const profile = profiles.find((p) => p.resumeOffline && p.id === marker.profile);
  if (!profile) return { ok: false };
  // Drapeau absent = éteint : tous ceux du profil doivent avoir été allumés au dernier contact.
  if (!profile.flags.every((flag) => marker.flags[flag] === true)) return { ok: false };
  return { ok: true, marker, profile };
}

function snapshot(flags: FlagSnapshot | null | undefined, fallback?: FlagSnapshot): FlagSnapshot {
  const out: FlagSnapshot = {};
  for (const name of resumeFlagNames()) out[name] = (flags ?? fallback)?.[name] === true;
  return out;
}

export function createOfflineResume(
  kv: ResumeKv,
  profiles: readonly OfflineReadProfile[] = OFFLINE_READ_PROFILES,
  revoked: RevokedStore | null = null,
) {
  // Les opérations passent l'une après l'autre : une purge lancée après une écriture l'emporte,
  // une écriture lancée après une purge repart d'un magasin vide.
  let chain: Promise<unknown> = Promise.resolve();
  function run<T>(op: () => Promise<T>): Promise<T> {
    const result = chain.then(op);
    chain = result.catch(() => undefined);
    return result;
  }

  const readRaw = () => kv.get<unknown>(RESUME_DB, RESUME_KEY);
  const drop = () => kv.del(RESUME_DB, RESUME_KEY);

  // Pierre tombale : jamais d'exception, un stockage illisible compte comme « pas de pierre ».
  const isRevoked = (): boolean => {
    try {
      return !!revoked?.read();
    } catch {
      return false;
    }
  };
  const lift = (): void => {
    try {
      revoked?.remove();
    } catch {
      /* retentée au prochain passage */
    }
  };
  /** Supprime le marqueur ; si IndexedDB refuse, pose la pierre tombale (seule trace : un userId). */
  async function revokeMarker(userId: number | null): Promise<void> {
    try {
      await drop();
      lift();
    } catch (err) {
      if (!revoked) throw err;
      try {
        revoked.write(JSON.stringify({ userId }));
      } catch {
        throw err;
      }
    }
  }

  return {
    /**
     * Après une réponse réseau réussie qui identifie le compte (`/api/auth/me`, connexion).
     * `flags` : valeur des drapeaux lue sur le réseau, `null` si pas encore connue (le marqueur du
     * même compte garde alors ses valeurs, un nouveau compte part éteint). Un rôle sans profil de
     * reprise n'écrit rien et efface le marqueur d'un compte précédent. Renvoie vrai si écrit.
     */
    record(user: { id: number; role: string }, flags: FlagSnapshot | null, now: number = Date.now()): Promise<boolean> {
      return run(async () => {
        const profile = resumeProfileOf(user.role, profiles);
        if (!profile || !Number.isInteger(user.id) || user.id <= 0) {
          await revokeMarker(null);
          return false;
        }
        const previous = parseMarker(await readRaw());
        const fallback = previous && previous.userId === user.id ? previous.flags : undefined;
        const marker: ResumeMarker = {
          version: RESUME_VERSION,
          userId: user.id,
          profile: profile.id,
          lastOnlineAt: now,
          expiresAt: now + RESUME_TTL_MS,
          flags: snapshot(flags, fallback),
        };
        await kv.set(RESUME_DB, RESUME_KEY, marker);
        // Connexion en ligne réussie : le marqueur révoqué est remplacé, la pierre tombale n'a plus d'objet.
        lift();
        return true;
      });
    },

    /**
     * Contact réseau réussi du compte actif : repousse l'échéance et rafraîchit les drapeaux.
     * Sans effet (et sans création) si le marqueur manque, est celui d'un autre compte ou est échu.
     */
    touch(userId: number, flags: FlagSnapshot | null, now: number = Date.now()): Promise<boolean> {
      return run(async () => {
        if (isRevoked()) return false;
        const raw = await readRaw();
        if (raw === undefined) return false;
        const marker = parseMarker(raw);
        if (!marker || marker.userId !== userId) return false;
        if (now > marker.expiresAt) {
          await drop();
          return false;
        }
        const next: ResumeMarker = {
          ...marker,
          lastOnlineAt: Math.max(now, marker.lastOnlineAt),
          expiresAt: Math.max(now, marker.lastOnlineAt) + RESUME_TTL_MS,
          flags: snapshot(flags, marker.flags),
        };
        await kv.set(RESUME_DB, RESUME_KEY, next);
        return true;
      });
    },

    /**
     * Lecture au démarrage hors ligne. N'écrit jamais, sauf pour supprimer un marqueur illisible,
     * échu, d'un profil sans reprise ou dont un drapeau est éteint.
     */
    read(now: number = Date.now()): Promise<ResumeGrant | null> {
      return run(async () => {
        if (isRevoked()) {
          // Révoqué : aucune restauration, et la purge est retentée (pierre levée si elle aboutit).
          await revokeMarker(null).catch(() => undefined);
          return null;
        }
        const raw = await readRaw();
        if (raw === undefined) return null;
        const verdict = judge(raw, now, profiles);
        if (!verdict.ok) {
          await drop();
          return null;
        }
        const { marker } = verdict;
        return {
          userId: marker.userId,
          profile: marker.profile,
          lastOnlineAt: marker.lastOnlineAt,
          expiresAt: marker.expiresAt,
          isFlagOn: (flag: string) => marker.flags[flag] === true,
        };
      });
    },

    /** Échéance pour l'affichage (bandeau), sans aucun effet de bord. */
    peek(now: number = Date.now()): Promise<{ expiresAt: number } | null> {
      return run(async () => {
        if (isRevoked()) return null;
        const verdict = judge(await readRaw(), now, profiles);
        return verdict.ok ? { expiresAt: verdict.marker.expiresAt } : null;
      });
    },

    /** Révocation (déconnexion, 401) : `userId` du compte révoqué, pour la pierre tombale si IndexedDB refuse. */
    clear(userId: number | null = null): Promise<void> {
      return run(() => revokeMarker(userId));
    },

    /** Événement d'un autre onglet : le marqueur d'un autre compte est périmé, celui du même reste. */
    clearIfNotUser(userId: number): Promise<void> {
      return run(async () => {
        const marker = parseMarker(await readRaw());
        if (!marker || marker.userId !== userId) await drop();
      });
    },
  };
}

export type OfflineResume = ReturnType<typeof createOfflineResume>;
