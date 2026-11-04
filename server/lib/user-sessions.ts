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
  let revoked: number | null = null;
  // Deux essais : un échec laisse le cookie valide sur les routes gardées par
  // `authenticate` seul et sur le WebSocket, qui ne relisent pas le compte.
  // Seuls `authorize`, `isAdmin` et `/api/auth/me` refusent un compte supprimé.
  for (let attempt = 1; attempt <= 2 && revoked === null; attempt++) {
    try {
      const result = await db.execute(
        sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)}`,
      );
      revoked = result.rowCount ?? 0;
    } catch (err) {
      log.error({ err, userId, reason, attempt }, "Révocation des sessions impossible");
    }
  }

  const closeUserConnections = (global as { closeUserConnections?: unknown }).closeUserConnections;
  if (typeof closeUserConnections === "function") {
    (closeUserConnections as (targetUserId: number, reason?: string) => void)(userId, reason);
  }

  if (revoked === null) {
    log.error({ userId, reason }, "Sessions du compte toujours actives : le cookie reste valide sur les routes gardées par authenticate seul");
    return 0;
  }
  log.info({ userId, reason, revoked }, "Accès du compte révoqué");
  return revoked;
}

type SqlExecutor = Pick<typeof db, "execute">;

/**
 * Changement de mot de passe, partie base : efface les AUTRES sessions du compte (table `session`),
 * celle de `keepSessionId` reste. À appeler avec le `tx` qui écrit le nouveau hash : tout ou rien.
 * Requête paramétrée. Idempotent : un second appel supprime 0 ligne.
 */
export async function deleteOtherUserSessions(executor: SqlExecutor, userId: number, keepSessionId: string | null = null): Promise<number> {
  // Sans session à garder (admin qui change le secret d'un autre compte) : toutes les sessions du compte partent.
  const result = await executor.execute(
    keepSessionId === null
      ? sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)}`
      : sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)} AND sid <> ${keepSessionId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Partie temps réel : ferme les sockets du compte hors `keepSessionId`. À appeler APRÈS le commit,
 * sinon une transaction annulée aurait déjà déconnecté les autres appareils.
 */
export function closeOtherUserConnections(userId: number, keepSessionId: string | null, reason: string): void {
  const closeUserConnections = (global as { closeUserConnections?: unknown }).closeUserConnections;
  if (typeof closeUserConnections === "function") {
    (closeUserConnections as (targetUserId: number, reason?: string, keepSessionId?: string) => void)(userId, reason, keepSessionId ?? undefined);
  }
}
