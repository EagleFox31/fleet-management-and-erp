import { pool } from "../../server/db";

/**
 * Attente d'un verrou observée dans Postgres, au lieu d'un délai fixe (leçon #549).
 *
 * Un test qui tient un verrou puis affirme « l'autre écriture attend » doit d'abord constater que
 * Postgres voit une requête bloquée PAR la connexion qui tient le verrou (pas par n'importe quel
 * verrou de la base). Garde-fou : `tests/unit/fixed-wait-lock-hygiene.test.ts`.
 */

/** Identifiant de processus serveur d'une connexion, à passer à `waitForBlockedBy`. */
export async function backendPid(client: { query: (text: string) => Promise<{ rows: any[] }> }): Promise<number> {
  const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
  return Number(rows[0].pid);
}

/** Rend la main dès qu'une requête attend un verrou tenu par `holderPid` ; échoue après `timeoutMs`. */
export async function waitForBlockedBy(holderPid: number, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))",
      [holderPid],
    );
    if (Number(rows[0].n) > 0) return;
    if (Date.now() > deadline) throw new Error(`${what} : aucune requête ne s'est bloquée sur le verrou`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
