import type { Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "../../shared/schema";
import { db, pool } from "../db";
import { AppError } from "./app-error";
import { moduleLogger } from "./logger";
import { LAST_ADMIN_MESSAGE, wouldLeaveNoActiveAdmin } from "./last-admin-rule";

const log = moduleLogger("last-admin");

export { LAST_ADMIN_MESSAGE, SELF_ADMIN_ROLE_MESSAGE, wouldLeaveNoActiveAdmin } from "./last-admin-rule";

/** Ids des administrateurs actifs (rôle admin, compte non supprimé). */
export async function listActiveAdminIds(): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.deletedAt)));
  return rows.map((row) => row.id);
}

/**
 * Sérialise les opérations qui peuvent retirer un administrateur actif : verrou consultatif
 * Postgres tenu sur une connexion dédiée jusqu'à la fin de la réponse HTTP (écriture de la route
 * aval comprise). Deux requêtes concurrentes ne lisent donc plus le même état « il reste un autre
 * admin ». Le verrou tombe aussi si la connexion se ferme.
 * Limite : seules les routes qui passent par cette garde sont sérialisées ; une écriture SQL directe
 * ne l'est pas (la garantie complète relève d'un trigger en base).
 */
export interface LockClient {
  query(sql: string): Promise<unknown>;
  release(err?: Error | boolean): void;
}
export interface LockPool {
  connect(): Promise<LockClient>;
}
export type LockResponse = Pick<Response, "once" | "end" | "writableEnded" | "writableFinished" | "destroyed">;

/**
 * Filet ultime : le verrou est lâché même si ni `res.end` ni `finish` n'arrivent. Il doit dépasser
 * le pire temps de l'écriture aval (pool saturé compris) : on accepte de perdre en disponibilité
 * (les demandeurs en attente passent en 409 au bout de 10 s), jamais en intégrité (deux admins
 * retirés en parallèle). Un minuteur lié à la socket ne sert donc pas de libération normale :
 * la libération normale est l'appel de `res.end`, qui suit l'écriture aval.
 */
export const LOCK_FALLBACK_MS = 30000;
export const ADMIN_BUSY_MESSAGE = "Opération en cours sur les administrateurs, réessayez.";

export async function holdLastAdminLock(
  res: LockResponse,
  options: { pool?: LockPool; fallbackMs?: number } = {},
): Promise<void> {
  const client = await (options.pool ?? (pool as unknown as LockPool)).connect();
  let released = false;
  let timer: NodeJS.Timeout | undefined;
  const release = () => {
    if (released) return;
    released = true;
    if (timer) clearTimeout(timer);
    // Verrou non rendu (échec du déverrouillage ou de la remise à zéro) : la connexion est détruite,
    // ce qui lâche le verrou côté Postgres, au lieu de la rendre au pool avec le verrou tenu.
    client
      .query("SELECT pg_advisory_unlock(hashtext('fleetmaster_last_admin'))")
      .then(() => client.query("RESET statement_timeout"))
      .then(() => client.release())
      .catch((err) => {
        log.error({ err }, "Libération du verrou dernier administrateur en échec");
        client.release(true);
      });
  };
  try {
    await client.query("SET statement_timeout = 10000");
    await client.query("SELECT pg_advisory_lock(hashtext('fleetmaster_last_admin'))");
  } catch (err) {
    released = true;
    client.release(err instanceof Error ? err : true);
    if ((err as { code?: string } | null)?.code === "57014") throw new AppError(409, ADMIN_BUSY_MESSAGE, { cause: err });
    throw err;
  }
  // La route appelle `res.end` après son écriture, même si la socket est détruite (où `finish` peut
  // ne jamais venir) : c'est le point de libération fiable. On restaure `end` d'origine ensuite.
  const originalEnd = res.end;
  res.end = function wrappedEnd(this: unknown, ...args: unknown[]) {
    try {
      return (originalEnd as (...a: unknown[]) => unknown).apply(res, args);
    } finally {
      if (res.end === wrappedEnd) res.end = originalEnd;
      release();
    }
  } as typeof res.end;
  // Coupure du client : l'écriture aval peut tourner encore. `close` sur socket détruite ne libère
  // pas avant `res.end` ; seul le filet long (LOCK_FALLBACK_MS) couvre une réponse jamais terminée.
  const onClose = () => {
    if (res.writableEnded) return release();
    if (timer) return;
    timer = setTimeout(release, options.fallbackMs ?? LOCK_FALLBACK_MS);
    timer.unref?.();
  };
  res.once("finish", release);
  res.once("close", onClose);
  // Le client a pu se couper pendant l'attente du verrou : `close` est déjà passé, il ne reviendra pas.
  if (res.writableFinished) release();
  else if (res.destroyed) onClose();
}

/**
 * À appeler avant une opération qui retire `targetId` des administrateurs actifs. Prend le verrou
 * (libéré à la fin de la réponse), relit l'état, lève `AppError(400)` si la cible est le dernier.
 */
export async function assertNotLastActiveAdmin(res: Response, targetId: number): Promise<void> {
  await holdLastAdminLock(res);
  if (wouldLeaveNoActiveAdmin(await listActiveAdminIds(), targetId)) {
    throw new AppError(400, LAST_ADMIN_MESSAGE);
  }
}
