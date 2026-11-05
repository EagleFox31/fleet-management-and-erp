import type { Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "../../shared/schema";
import { db, pool } from "../db";
import { AppError } from "./app-error";
import { moduleLogger } from "./logger";

const log = moduleLogger("last-admin");

import { LAST_ADMIN_MESSAGE, wouldLeaveNoActiveAdmin } from "./last-admin-rule";

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
export async function holdLastAdminLock(res: Response): Promise<void> {
  const client = await pool.connect();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    client
      .query("SELECT pg_advisory_unlock(hashtext('fleetmaster_last_admin'))")
      .catch((err) => log.error({ err }, "Libération du verrou dernier administrateur en échec"))
      .finally(() => {
        client.query("RESET statement_timeout").catch(() => undefined).finally(() => client.release());
      });
  };
  try {
    await client.query("SET statement_timeout = 10000");
    await client.query("SELECT pg_advisory_lock(hashtext('fleetmaster_last_admin'))");
  } catch (err) {
    released = true;
    client.release(err instanceof Error ? err : true);
    throw err;
  }
  res.once("finish", release);
  res.once("close", release);
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
