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

/**
 * Changement de mot de passe : efface les AUTRES sessions du compte (table `session`) et ferme
 * leurs sockets temps réel ; la session `keepSessionId` reste ouverte. Requête paramétrée.
 *
 * Contrairement à `revokeUserAccess`, un échec est remonté : l'appelant décide de la réponse.
 * Idempotent : un second appel supprime 0 ligne.
 */
export async function revokeOtherUserSessions(userId: number, keepSessionId: string, reason: string): Promise<number> {
  const result = await db.execute(
    sql`DELETE FROM "session" WHERE sess->>'userId' = ${String(userId)} AND sid <> ${keepSessionId}`,
  );
  const revoked = result.rowCount ?? 0;

  const closeUserConnections = (global as { closeUserConnections?: unknown }).closeUserConnections;
  if (typeof closeUserConnections === "function") {
    (closeUserConnections as (targetUserId: number, reason?: string, keepSessionId?: string) => void)(userId, reason, keepSessionId);
  }
  log.info({ userId, reason, revoked }, "Autres sessions du compte révoquées");
  return revoked;
}
