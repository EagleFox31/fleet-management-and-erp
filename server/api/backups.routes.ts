import { Router, type RequestHandler } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  backupAlertsResponseSchema,
  backupRunsResponseSchema,
  runBackupResponseSchema,
  type BackupAlert,
  type BackupRun,
} from "@shared/contracts/backups";
import { backupRuns } from "@shared/schema";
import { db } from "../db";
import { BACKUP_MAX_AGE_MS, runBackup } from "../jobs/backup";
import { createProductionBackupDeps } from "../jobs/backup-production";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authenticate, isAdmin } from "../middleware/auth";

const log = moduleLogger("backups-routes");

/** Une exécution « running » plus vieille que ceci est considérée comme orpheline (arrêt brutal). */
const RUNNING_STALE_MS = 30 * 60 * 1000;
/** Attente maximale de la création de la ligne `backup_runs` après un déclenchement. */
const START_WAIT_MS = 5000;

type Row = typeof backupRuns.$inferSelect;

/** Projection publique : jamais `location` (chemin du fichier), jamais de message technique. */
export function toBackupRun(row: Row): BackupRun {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    sizeBytes: row.sizeBytes,
    durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
    checksum: row.checksum,
    errorCode: row.errorCode,
  };
}

/** Règle pure des alertes, horloge injectée. `runs` triés du plus récent au plus ancien. */
export function computeBackupAlerts(runs: readonly Row[], now: Date): BackupAlert[] {
  const alerts: BackupAlert[] = [];
  const lastFinished = runs.find((r) => r.status !== "running");
  if (lastFinished?.status === "failed") {
    alerts.push({
      kind: "last_run_failed",
      message: "La dernière sauvegarde a échoué.",
      since: (lastFinished.finishedAt ?? lastFinished.startedAt).toISOString(),
    });
  }
  const lastSuccess = runs.find((r) => r.status === "success");
  const successAt = lastSuccess ? (lastSuccess.finishedAt ?? lastSuccess.startedAt) : null;
  if (!successAt || now.getTime() - successAt.getTime() > BACKUP_MAX_AGE_MS) {
    alerts.push({
      kind: "no_recent_success",
      message: "Aucune sauvegarde réussie depuis plus de 24 heures.",
      since: successAt?.toISOString() ?? null,
    });
  }
  return alerts;
}

const listRuns: RequestHandler = async (_req, res, next) => {
  try {
    const rows = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt), desc(backupRuns.id)).limit(100);
    res.status(200).json(backupRunsResponseSchema.parse(rows.map(toBackupRun)));
  } catch (error) {
    next(error);
  }
};

const listAlerts: RequestHandler = async (_req, res, next) => {
  try {
    const rows = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt), desc(backupRuns.id)).limit(50);
    res.status(200).json(backupAlertsResponseSchema.parse(computeBackupAlerts(rows, new Date())));
  } catch (error) {
    next(error);
  }
};

async function findRunning(): Promise<Row | undefined> {
  const since = new Date(Date.now() - RUNNING_STALE_MS);
  const [row] = await db
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.status, "running"), gte(backupRuns.startedAt, since)))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1);
  return row;
}

/**
 * Déclenchement manuel, asynchrone : 202 avec la ligne `backup_runs`. Si une exécution tourne déjà,
 * c'est elle qui est renvoyée (contrat `backups` : pas de doublon) ; le verrou consultatif de
 * `runBackup` ferme la course entre deux déclenchements simultanés.
 */
const runNow: RequestHandler = async (req, res, next) => {
  try {
    const running = await findRunning();
    if (running) return void res.status(202).json(runBackupResponseSchema.parse(toBackupRun(running)));

    const startedAfter = new Date(Date.now() - 1000);
    const outcome = runBackup(createProductionBackupDeps(), { force: true }).catch((err) => {
      log.error({ err, requestId: req.requestId }, "déclenchement manuel de sauvegarde en échec");
      return null;
    });

    const deadline = Date.now() + START_WAIT_MS;
    let row: Row | undefined;
    while (!row && Date.now() < deadline) {
      [row] = await db
        .select()
        .from(backupRuns)
        .where(gte(backupRuns.startedAt, startedAfter))
        .orderBy(desc(backupRuns.startedAt))
        .limit(1);
      if (!row) {
        const settled = await Promise.race([outcome, new Promise<"pending">((r) => setTimeout(() => r("pending"), 150))]);
        if (settled !== "pending") {
          row = (await findRunning()) ?? undefined; // verrou tenu ailleurs : on renvoie l'exécution en cours
          break;
        }
      }
    }
    if (!row) return next(new AppError(503, "La sauvegarde n'a pas pu démarrer. Réessayez dans un instant."));
    res.status(202).json(runBackupResponseSchema.parse(toBackupRun(row)));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/admin/backups", authenticate, isAdmin, listRuns);
router.get("/admin/backups/alerts", authenticate, isAdmin, listAlerts);
router.post("/admin/backups/run", authenticate, isAdmin, runNow);

export default router;
