/**
 * Sauvegarde quotidienne de la base (T-19a/b, P-06).
 *
 * Orchestration pure : toutes les dépendances sont injectées (dépôt des
 * exécutions, stockage, dump, chiffrement, verrou, horloge, alerte). Les
 * adaptateurs de production sont dans `createProductionBackupDeps`.
 *
 * - verrou consultatif Postgres : deux exécutions simultanées n'en produisent qu'une ;
 * - rattrapage : lancée si la dernière réussite date de plus de 24 h (l'instance
 *   autoscale peut dormir à l'heure prévue), un seul rattrapage, pas de rafale ;
 * - purge : fichiers et lignes de plus de 12 mois ;
 * - échec : ligne `failed` + code d'erreur (jamais le message technique), puis
 *   alerte `alert_created` et événement `backup_failed`.
 */
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { BackupRun, BackupStatus } from "@shared/contracts/backups";
import { moduleLogger } from "../lib/logger";
import type { BackupStorage } from "../lib/backup/storage";
import { BackupCryptoError, encryptFile, parseBackupKey } from "../lib/backup/encrypt";
import { BackupDumpError, checkPgDump, runPgDump } from "../lib/backup/dump";

const log = moduleLogger("backup");

export const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BACKUP_RETENTION_MONTHS = 12;
export const BACKUP_LOCK_KEY = "backup";

export interface BackupRunRecord {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: BackupStatus;
  sizeBytes: number | null;
  durationMs: number | null;
  checksum: string | null;
  errorCode: string | null;
  /** Nom du fichier chiffré dans le stockage. */
  fileName: string | null;
}

/** Table `backup_runs` (db-1, T-07). L'adaptateur Drizzle est branché quand le schéma est poussé. */
export interface BackupRunRepository {
  insertRunning(startedAt: Date): Promise<{ id: number }>;
  finish(
    id: number,
    patch: Partial<Pick<BackupRunRecord, "status" | "finishedAt" | "sizeBytes" | "durationMs" | "checksum" | "errorCode" | "fileName">>,
  ): Promise<void>;
  lastSuccessAt(): Promise<Date | null>;
  /** Supprime les lignes antérieures à `cutoff` et renvoie leurs fichiers. */
  deleteOlderThan(cutoff: Date): Promise<string[]>;
}

export interface BackupLock {
  /** Renvoie false si une autre exécution tient le verrou. */
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface BackupDeps {
  repo: BackupRunRepository;
  storage: BackupStorage;
  lock: BackupLock;
  now: () => Date;
  /** Produit le dump clair dans `outPath`. */
  dump: (outPath: string) => Promise<void>;
  /** Chiffre `inPath` vers `outPath`. */
  encrypt: (inPath: string, outPath: string) => Promise<{ sizeBytes: number; checksum: string }>;
  /** Contrôle préalable (présence et version de pg_dump). */
  preflight?: () => Promise<void>;
  /** Alerte admin + événement temps réel. */
  notifyFailure: (info: { runId: number; errorCode: string }) => Promise<void>;
  tmpDir?: string;
}

export type BackupOutcome =
  | { kind: "skipped_locked" }
  | { kind: "skipped_recent" }
  | { kind: "success"; runId: number; fileName: string }
  | { kind: "failed"; runId: number; errorCode: string };

/** Décision « à faire ? » avec horloge injectée. */
export function isBackupDue(lastSuccess: Date | null, now: Date, maxAgeMs = BACKUP_MAX_AGE_MS): boolean {
  return lastSuccess === null || now.getTime() - lastSuccess.getTime() > maxAgeMs;
}

export function retentionCutoff(now: Date, months = BACKUP_RETENTION_MONTHS): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof BackupDumpError || error instanceof BackupCryptoError) return error.code;
  return "BACKUP_FAILED";
}

export function backupFileName(now: Date): string {
  return `fleetmaster-${now.toISOString().replace(/[:.]/g, "-")}.dump.enc`;
}

async function purge(deps: BackupDeps): Promise<number> {
  const files = await deps.repo.deleteOlderThan(retentionCutoff(deps.now()));
  for (const f of files) await deps.storage.remove(f).catch((err) => log.warn({ err }, "purge d'un fichier impossible"));
  return files.length;
}

/**
 * Exécute une sauvegarde. `force` ignore le test « dernière réussite < 24 h »
 * (déclenchement manuel) mais jamais le verrou.
 */
export async function runBackup(deps: BackupDeps, opts: { force?: boolean } = {}): Promise<BackupOutcome> {
  if (!(await deps.lock.tryAcquire())) return { kind: "skipped_locked" };
  try {
    if (!opts.force && !isBackupDue(await deps.repo.lastSuccessAt(), deps.now())) {
      return { kind: "skipped_recent" };
    }

    const startedAt = deps.now();
    const { id } = await deps.repo.insertRunning(startedAt);
    const tmp = path.join(deps.tmpDir ?? os.tmpdir(), `fm-dump-${randomBytes(6).toString("hex")}.tmp`);
    const fileName = backupFileName(startedAt);
    try {
      await deps.preflight?.();
      await deps.dump(tmp);
      const target = await deps.storage.prepare(fileName);
      const { sizeBytes, checksum } = await deps.encrypt(tmp, target);
      const finishedAt = deps.now();
      await deps.repo.finish(id, {
        status: "success",
        finishedAt,
        sizeBytes,
        checksum,
        fileName,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorCode: null,
      });
      await purge(deps).catch((err) => log.warn({ err }, "purge des sauvegardes en échec"));
      log.info({ runId: id, sizeBytes }, "sauvegarde terminée");
      return { kind: "success", runId: id, fileName };
    } catch (err) {
      const errorCode = errorCodeOf(err);
      log.error({ err, runId: id, errorCode }, "sauvegarde en échec");
      await deps.storage.remove(fileName).catch(() => undefined);
      const finishedAt = deps.now();
      await deps.repo
        .finish(id, { status: "failed", finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), errorCode })
        .catch((e) => log.error({ err: e, runId: id }, "écriture de l'échec impossible"));
      await deps.notifyFailure({ runId: id, errorCode }).catch((e) => log.error({ err: e, runId: id }, "alerte d'échec non envoyée"));
      return { kind: "failed", runId: id, errorCode };
    } finally {
      await rm(tmp, { force: true });
    }
  } finally {
    await deps.lock.release();
  }
}

/** Tâche du scheduler : ne fait rien si la sauvegarde n'est pas due. */
export function runDailyBackup(deps: BackupDeps): Promise<BackupOutcome> {
  return runBackup(deps);
}

/** Adaptateur de production pour tout sauf le dépôt `backup_runs` (fourni par db-1) et le verrou. */
export function createCommandDeps(databaseUrl: string): Pick<BackupDeps, "dump" | "encrypt" | "preflight"> {
  return {
    preflight: async () => {
      await checkPgDump();
    },
    dump: (out) => runPgDump(databaseUrl, out),
    encrypt: (inPath, outPath) => encryptFile(inPath, outPath, parseBackupKey(process.env.BACKUP_KEY)),
  };
}

export type { BackupRun };
