import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { alerts, fuelRecords, maintenanceSchedules, parts, users, vehicles, workOrders } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { suppressSideEffects } from "../lib/suppress-side-effects";

/**
 * Restauration d'une sauvegarde JSON (`backup/fleet-backup-*.json`), déplacée de `server/routes.ts`.
 *
 * Tout ou rien : une seule transaction, effets secondaires des triggers coupés. Avant, les
 * suppressions et insertions passaient hors transaction et les triggers carburant alertaient
 * sur chaque plein repris : l'insertion des alertes sauvegardées échouait ensuite en 23505
 * (uq_alerts_user_dedupe) et la base restait à moitié restaurée.
 */
export type BackupImportStats = {
  users: number;
  vehicles: number;
  parts: number;
  workOrders: number;
  maintenanceSchedules: number;
  fuelRecords: number;
  alerts: number;
};

export type BackupData = {
  exportDate?: string;
  users?: Array<typeof users.$inferInsert>;
  vehicles?: Array<typeof vehicles.$inferInsert>;
  parts?: Array<typeof parts.$inferInsert>;
  workOrders?: Array<typeof workOrders.$inferInsert>;
  maintenanceSchedules?: Array<typeof maintenanceSchedules.$inferInsert>;
  fuelRecords?: Array<typeof fuelRecords.$inferInsert>;
  alerts?: Array<typeof alerts.$inferInsert>;
};

/** Premier fichier `fleet-backup-*.json` du dossier ; 404 sans exposer le listage (AGENTS.md §10). */
export function readBackupFile(backupDir = join(process.cwd(), "backup")): { backupFile: string; data: BackupData } {
  if (!existsSync(backupDir)) throw new AppError(404, "Dossier de backup non trouvé");
  const backupFile = readdirSync(backupDir).find((f) => f.startsWith("fleet-backup-") && f.endsWith(".json"));
  if (!backupFile) throw new AppError(404, "Fichier de backup non trouvé");
  return { backupFile, data: JSON.parse(readFileSync(join(backupDir, backupFile), "utf8")) as BackupData };
}

export async function restoreBackup(data: BackupData): Promise<BackupImportStats> {
  return db.transaction(async (tx) => {
    await suppressSideEffects(tx);

    // Nettoyer les tables (sauf utilisateurs pour garder l'admin)
    await tx.delete(alerts);
    await tx.delete(fuelRecords);
    await tx.delete(maintenanceSchedules);
    await tx.delete(workOrders);
    await tx.delete(parts);
    await tx.delete(vehicles);

    const stats: BackupImportStats = {
      users: 0,
      vehicles: 0,
      parts: 0,
      workOrders: 0,
      maintenanceSchedules: 0,
      fuelRecords: 0,
      alerts: 0,
    };

    // Utilisateurs : seulement ceux dont le nom d'utilisateur n'existe pas encore.
    if (data.users?.length) {
      const existing = new Set((await tx.select({ username: users.username }).from(users)).map((u) => u.username));
      const toImport = data.users.filter((u) => !existing.has(u.username));
      if (toImport.length > 0) {
        await tx.insert(users).values(toImport);
        stats.users = toImport.length;
      }
    }
    if (data.vehicles?.length) {
      await tx.insert(vehicles).values(data.vehicles);
      stats.vehicles = data.vehicles.length;
    }
    if (data.parts?.length) {
      await tx.insert(parts).values(data.parts);
      stats.parts = data.parts.length;
    }
    if (data.workOrders?.length) {
      await tx.insert(workOrders).values(data.workOrders);
      stats.workOrders = data.workOrders.length;
    }
    if (data.maintenanceSchedules?.length) {
      await tx.insert(maintenanceSchedules).values(data.maintenanceSchedules);
      stats.maintenanceSchedules = data.maintenanceSchedules.length;
    }
    if (data.fuelRecords?.length) {
      await tx.insert(fuelRecords).values(data.fuelRecords);
      stats.fuelRecords = data.fuelRecords.length;
    }
    if (data.alerts?.length) {
      await tx.insert(alerts).values(data.alerts);
      stats.alerts = data.alerts.length;
    }
    return stats;
  });
}
