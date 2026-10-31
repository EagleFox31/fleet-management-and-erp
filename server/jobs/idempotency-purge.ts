/**
 * Purge des clés d'idempotence expirées (CDC #10). Squelette sans effet du lot CDC-0a.
 *
 * Garde-fous, dans l'ordre : drapeau `technician-offline` coupé, rien ; verrou consultatif
 * Postgres non obtenu (une autre instance purge), rien ; table `idempotency_keys` absente
 * (créée par le lot DB-1), rien. Le lot #10b fournit la suppression réelle (`purgeExpired`).
 *
 * Verrou : `pg_try_advisory_lock` est lié à la session, donc pris sur une connexion dédiée
 * de la chaîne directe (`listenerPool`), jamais sur le pool poolé (voir `backup-production.ts`).
 */
import { isFeatureEnabled } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("idempotency-purge");

export const IDEMPOTENCY_PURGE_LOCK_KEY = "fleetos:idempotency-purge";

export type IdempotencyPurgeDeps = {
  isEnabled: () => boolean;
  /** Vrai si le verrou est obtenu. */
  tryLock: () => Promise<boolean>;
  unlock: () => Promise<void>;
  tableExists: () => Promise<boolean>;
  /** Supprime les clés expirées et renvoie leur nombre. Rempli par le lot #10b. */
  purgeExpired: () => Promise<number>;
};

export type IdempotencyPurgeOutcome = "disabled" | "locked" | "no-table" | "purged";

export async function runIdempotencyPurge(deps: IdempotencyPurgeDeps): Promise<IdempotencyPurgeOutcome> {
  if (!deps.isEnabled()) return "disabled";
  if (!(await deps.tryLock())) return "locked";
  try {
    if (!(await deps.tableExists())) return "no-table";
    const purged = await deps.purgeExpired();
    if (purged > 0) log.info({ purged }, "clés d'idempotence expirées supprimées");
    return "purged";
  } finally {
    await deps.unlock();
  }
}

/** Adaptateurs de production. Importés à la demande : le module reste testable sans base. */
export async function createProductionIdempotencyPurgeDeps(): Promise<IdempotencyPurgeDeps> {
  const { db, listenerPool } = await import("../db");
  const { sql } = await import("drizzle-orm");
  type LockClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ ok?: boolean }> }>; release: () => void };
  let client: LockClient | null = null;
  return {
    isEnabled: () => isFeatureEnabled("technician-offline"),
    async tryLock() {
      const c = (await (listenerPool as unknown as { connect: () => Promise<LockClient> }).connect());
      try {
        const res = await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [IDEMPOTENCY_PURGE_LOCK_KEY]);
        if (res.rows[0]?.ok === true) {
          client = c;
          return true;
        }
      } catch (err) {
        c.release();
        throw err;
      }
      c.release();
      return false;
    },
    async unlock() {
      if (!client) return;
      const c = client;
      client = null;
      try {
        await c.query("SELECT pg_advisory_unlock(hashtext($1))", [IDEMPOTENCY_PURGE_LOCK_KEY]);
      } finally {
        c.release();
      }
    },
    async tableExists() {
      const result = await db.execute(sql`SELECT to_regclass('public.idempotency_keys') IS NOT NULL AS present`);
      const rows = (result as unknown as { rows?: Array<{ present?: boolean }> }).rows ?? [];
      return rows[0]?.present === true;
    },
    purgeExpired: async () => 0,
  };
}

/** Un tick du planificateur : jamais d'exception vers l'appelant. */
export async function idempotencyPurgeTick(): Promise<void> {
  try {
    if (!isFeatureEnabled("technician-offline")) return;
    await runIdempotencyPurge(await createProductionIdempotencyPurgeDeps());
  } catch (err) {
    log.error({ err }, "purge des clés d'idempotence en échec");
  }
}
