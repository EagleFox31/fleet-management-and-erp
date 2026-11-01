import { sql } from "drizzle-orm";
import { db } from "../db";
import { moduleLogger } from "./logger";

const log = moduleLogger("user-sessions");

/**
 * Coupe l'accès d'un compte supprimé ou désactivé : efface ses sessions
 * (table `session` de connect-pg-simple) et ferme ses connexions temps réel.
 * Sans cela, un cookie ouvert avant la suppression reste valide sur toutes
 * les routes gardées par `authenticate` seul.
 *
 * Idempotent : un second appel ne trouve plus rien à effacer.
 */
export async function revokeUserAccess(userId: number, reason: string): Promise<number> {
  let revoked = 0;
  try {
    const result = await db.execute(
      sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)}`,
    );
    revoked = result.rowCount ?? 0;
  } catch (err) {
    // Les gardes refusent de toute façon un compte supprimé : on journalise
    // l'échec sans faire échouer la suppression elle-même.
    log.error({ err, userId, reason }, "Révocation des sessions impossible");
  }

  const closeUserConnections = (global as { closeUserConnections?: unknown }).closeUserConnections;
  if (typeof closeUserConnections === "function") {
    (closeUserConnections as (targetUserId: number, reason?: string) => void)(userId, reason);
  }

  log.info({ userId, reason, revoked }, "Accès du compte révoqué");
  return revoked;
}
