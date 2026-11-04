import { Router, type NextFunction, type Request, type Response } from "express";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { moduleLogger } from "../lib/logger";
import { authenticate, isAdmin } from "../middleware/auth";
import { readBackupFile, restoreBackup } from "../services/backup-import-service";

const log = moduleLogger("admin-import-backup");

const router = Router();

/** Restauration de sauvegarde (admin), déplacée de `server/routes.ts` (gelé, AGENTS.md §9). */
router.post("/admin/import-backup", authenticate, isAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { backupFile, data } = readBackupFile();
    log.info({ requestId: req.requestId, backupFile }, "import de backup en cours");

    const stats = await restoreBackup(data);

    log.info({ requestId: req.requestId, backupFile, importStats: stats }, "import de backup terminé");
    res.json({
      success: true,
      message: "Données importées avec succès",
      stats,
      backupFile,
      exportDate: data.exportDate,
    });
  } catch (error) {
    // Message générique + référence par le gestionnaire central ; le détail reste dans le log (AGENTS.md §10).
    next(
      withLogContext(
        error instanceof AppError ? error : new AppError(500, "Erreur lors de l'import des données.", { cause: error }),
        { event: "admin.import_backup.failed" },
      ),
    );
  }
});

export default router;
