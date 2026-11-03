import { Router, type RequestHandler } from "express";
import { ALERT_READ_ALL_PATH, alertPath } from "@shared/contracts/alerts";
import { AppError } from "../lib/app-error";
import { isAnyUser } from "../middleware/auth";
import { alertInboxService } from "../services/alert-inbox-service";

/**
 * Écritures sur la boîte d'alertes (ALR2). L'utilisateur vient de la session,
 * jamais de l'URL ni du corps. Remplace les routes de `server/routes.ts`, qui
 * ne vérifiaient pas le propriétaire : n'importe quel compte pouvait marquer lue
 * ou supprimer l'alerte d'un autre.
 */
function parseAlertId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "Identifiant d'alerte invalide.");
  return id;
}

/** Couche 2 : les autres onglets ou appareils du même compte mettent leur compteur à jour. */
function broadcastAlertsRead(userId: number, alertIds: number[]): void {
  if (alertIds.length === 0) return;
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  broadcastUpdate("alerts_read", {
    entity: "alert",
    payload: { alertIds },
    scope: { type: "user", userIds: [userId] },
  });
}

const markRead: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const alert = await alertInboxService.markRead(userId, parseAlertId(req.params.id));
    broadcastAlertsRead(userId, [alert.id]);
    res.status(200).json(alert);
  } catch (error) {
    next(error);
  }
};

const markAllRead: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const alertIds = await alertInboxService.markAllRead(userId);
    broadcastAlertsRead(userId, alertIds);
    res.status(200).json({ updated: alertIds.length });
  } catch (error) {
    next(error);
  }
};

const removeAlert: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const alertId = parseAlertId(req.params.id);
    await alertInboxService.remove(userId, alertId);
    broadcastAlertsRead(userId, [alertId]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const router = Router();
// Déclarée avant `/:id/...` : « read-all » n'est pas un identifiant.
// Chemins relatifs au montage `/api` (server/app.ts).
const relative = (path: string) => path.replace(/^\/api/, "");
router.post(relative(ALERT_READ_ALL_PATH), isAnyUser, markAllRead);
router.patch(`${relative(alertPath(":id"))}/read`, isAnyUser, markRead);
router.delete(relative(alertPath(":id")), isAnyUser, removeAlert);

export default router;
