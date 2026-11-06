import { pool } from "../../server/db";

/**
 * Attend qu'une requête soit bloquée PAR la connexion qui tient le verrou (`holderPid`).
 * Sert aux tests de course déterministes : une connexion verrouille la ligne, la requête testée
 * s'y bloque après sa lecture, la ligne est modifiée, puis le verrou est libéré.
 */
export async function waitForBlockedWriter(holderPid: number, what = "la ligne"): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`la requête ne s'est jamais bloquée sur le verrou de ${what}`);
}
