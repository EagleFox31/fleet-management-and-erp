/**
 * Sauvegardes de la base (P-06), administration.
 *
 * Une exécution relancée pendant qu'une autre tourne ne crée pas de doublon :
 * le serveur renvoie l'exécution en cours (verrou consultatif).
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const BACKUPS_PATH = "/api/admin/backups";
export const BACKUP_ALERTS_PATH = "/api/admin/backups/alerts";
export const RUN_BACKUP_PATH = "/api/admin/backups/run";

export const BACKUP_STATUSES = ["running", "success", "failed"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const backupRunSchema = z.object({
  id: z.number().int(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  status: z.enum(BACKUP_STATUSES),
  sizeBytes: z.number().int().min(0).nullable(),
  durationMs: z.number().int().min(0).nullable(),
  checksum: z.string().nullable(),
  /** Code d'erreur interne (jamais le message technique), pour l'affichage d'un libellé. */
  errorCode: z.string().nullable(),
});

export const backupRunsResponseSchema = z.array(backupRunSchema);

export const backupAlertSchema = z.object({
  kind: z.enum(["last_run_failed", "no_recent_success"]),
  message: z.string(),
  since: isoDateTimeSchema.nullable(),
});

export const backupAlertsResponseSchema = z.array(backupAlertSchema);

export const runBackupResponseSchema = backupRunSchema;

export type BackupRun = z.infer<typeof backupRunSchema>;
export type BackupAlert = z.infer<typeof backupAlertSchema>;
