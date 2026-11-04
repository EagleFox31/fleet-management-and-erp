/**
 * Adaptateurs de production de la sauvegarde (T-19b) : dépôt `backup_runs`
 * (Drizzle), verrou consultatif Postgres, alerte admin et événement temps réel.
 *
 * Verrou : `pg_try_advisory_lock` est lié à la session, donc pris sur une
 * connexion dédiée de la chaîne directe (`listenerPool`), jamais sur le pool
 * poolé, et relâché (connexion rendue) en fin d'exécution.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { backupRuns } from "@shared/schema";
import { db, listenerPool } from "../db";
import { storage } from "../storage";
import { LocalBackupStorage } from "../lib/backup/storage";
import { moduleLogger } from "../lib/logger";
import {
  BACKUP_LOCK_KEY,
  createCommandDeps,
  isBackupScheduleEnabled,
  runDailyBackup,
  type BackupDeps,
  type BackupLock,
  type BackupOutcome,
  type BackupRunRepository,
} from "./backup";

const log = moduleLogger("backup");

export function createDrizzleBackupRepository(): BackupRunRepository {
  return {
    async insertRunning(startedAt) {
      const [row] = await db.insert(backupRuns).values({ startedAt, status: "running" }).returning({ id: backupRuns.id });
      return { id: row.id };
    },
    async finish(id, patch) {
      await db
        .update(backupRuns)
        .set({
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.finishedAt !== undefined && { finishedAt: patch.finishedAt }),
          ...(patch.sizeBytes !== undefined && { sizeBytes: patch.sizeBytes }),
          ...(patch.checksum !== undefined && { checksum: patch.checksum }),
          ...(patch.errorCode !== undefined && { errorCode: patch.errorCode }),
          // La table n'a pas de colonne durée (calculée à la lecture) : le nom du fichier est la `location`.
          ...(patch.fileName !== undefined && { location: patch.fileName }),
        })
        .where(eq(backupRuns.id, id));
    },
    async lastSuccessAt() {
      const [row] = await db
        .select({ finishedAt: backupRuns.finishedAt })
        .from(backupRuns)
        .where(eq(backupRuns.status, "success"))
        .orderBy(desc(backupRuns.finishedAt))
        .limit(1);
      return row?.finishedAt ?? null;
    },
    async deleteOlderThan(cutoff) {
      const old = await db
        .delete(backupRuns)
        .where(and(lt(backupRuns.startedAt, cutoff)))
        .returning({ location: backupRuns.location });
      return old.map((r) => r.location).filter((l): l is string => !!l);
    },
  };
}

/**
 * Verrou consultatif sur une connexion directe dédiée. La clé est injectable pour les tests :
 * celle de production est commune à toute la base, un serveur local qui sauvegarde sur la
 * même base de test la tiendrait (#298).
 */
export function createAdvisoryBackupLock(lockKey: string = BACKUP_LOCK_KEY): BackupLock {
  let client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ ok?: boolean }> }>; release: () => void } | null = null;
  return {
    async tryAcquire() {
      const c = (await (listenerPool as any).connect()) as NonNullable<typeof client>;
      try {
        const res = await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [lockKey]);
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
    async release() {
      if (!client) return;
      const c = client;
      client = null;
      try {
        await c.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
      } finally {
        c.release();
      }
    },
  };
}

/** Alerte critique aux admins (dédupliquée par exécution) puis événement `backup_failed`. */
export async function notifyBackupFailure(info: { runId: number; errorCode: string }): Promise<void> {
  const admins = await storage.getUsersByRole("admin");
  for (const admin of admins) {
    const created = await storage.createAlert({
      userId: admin.id,
      title: "Sauvegarde de la base en échec",
      message: `La sauvegarde automatique a échoué (code ${info.errorCode}). Consultez l'administration des sauvegardes.`,
      type: "maintenance",
      priority: "critical",
      link: "/admin/backups",
      topic: "backup",
      dedupeKey: `backup_failed:${info.runId}`,
    });
    const broadcast = (global as any).broadcastUpdate;
    if (typeof broadcast === "function" && created?.id) {
      broadcast("alert_created", {
        entity: "alert",
        entityId: created.id,
        payload: { alertId: created.id, userId: admin.id, title: created.title, message: created.message, type: created.type, priority: "critical", link: "/admin/backups" },
        scope: { type: "user", userIds: [admin.id] },
      });
    }
  }
  const broadcast = (global as any).broadcastUpdate;
  if (typeof broadcast === "function") {
    broadcast("backup_failed", {
      entity: "backup",
      entityId: info.runId,
      payload: { id: info.runId },
      scope: { type: "roles", roles: ["admin"] },
    });
  }
}

export function createProductionBackupDeps(): BackupDeps {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "";
  return {
    repo: createDrizzleBackupRepository(),
    storage: new LocalBackupStorage(),
    lock: createAdvisoryBackupLock(),
    now: () => new Date(),
    notifyFailure: notifyBackupFailure,
    ...createCommandDeps(url),
  };
}

/** Après un échec, pas de nouvelle tentative avant ce délai (évite une alerte toutes les 5 min). */
export const BACKUP_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let cooldownUntil = 0;

/** Appelée par le scheduler à chaque tick et au démarrage ; silencieuse tant que rien n'est dû. */
export async function backupTick(now = Date.now(), deps: BackupDeps = createProductionBackupDeps()): Promise<BackupOutcome | null> {
  if (!isBackupScheduleEnabled() || now < cooldownUntil) return null;
  const outcome = await runDailyBackup(deps);
  if (outcome.kind === "failed") cooldownUntil = now + BACKUP_RETRY_COOLDOWN_MS;
  if (outcome.kind !== "skipped_recent") log.info({ outcome: outcome.kind }, "tick de sauvegarde");
  return outcome;
}
