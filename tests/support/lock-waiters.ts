import { sql } from "drizzle-orm";
import { db } from "../../server/db";

/**
 * Attente d'un verrou observée dans Postgres, ciblée sur la connexion qui le tient.
 *
 * Un filtre sur le texte des requêtes (`query ILIKE '%table%'`) compte aussi les sessions
 * d'une autre suite bloquées ailleurs dans la base. Ici, seules comptent les sessions
 * bloquées derrière `holderPid`, directement ou en file derrière une autre.
 */

type SqlExecutor = { execute: typeof db.execute };

/** Identifiant du processus serveur de la connexion (transaction de test comprise). */
export async function pidOf(executor: SqlExecutor): Promise<number> {
  const result = await executor.execute(sql`SELECT pg_backend_pid() AS pid`);
  return Number((result.rows[0] as { pid: number }).pid);
}

/** Rend la main dès que `count` sessions attendent le verrou tenu par `holderPid` ; échoue après `timeoutMs`. */
export async function waitForWaitersOn(holderPid: number, count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await db.execute(sql`
      WITH RECURSIVE chain(pid) AS (
        SELECT ${holderPid}::int
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int - 1 AS n FROM chain`);
    if (Number((result.rows[0] as { n: number }).n) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`${count} session(s) attendue(s) sur le verrou du pid ${holderPid}, pas atteint.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
