import { Router } from "express";
import { authenticate, isAnyUser, isStaff, isTechnician } from "../middleware/auth";
import { assertWorkOrderReadable } from "../lib/work-order-scope";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("work-order-items");
import { storage } from "../storage";
import { AppError, isAppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";

const WORK_ORDER_ID_INVALID_MESSAGE = "Identifiant d'ordre de travail invalide.";
const ITEM_ID_INVALID_MESSAGE = "Identifiant de ligne invalide.";
import { workOrderItemsService } from "../services/work-order-items-service";
import { workOrderStaffScope } from "../lib/work-order-realtime-scope";

/**
 * Lignes de travail d'un ordre de travail — heures passées, sans valorisation.
 *
 * Trois routeurs plutôt qu'un, pour que la garde de rôle vive **au montage**
 * (`server/api/index.ts`) partout où c'est sans risque :
 *
 * - `workOrderItemsRoutes` se greffe sur `/work-orders`, un préfixe que
 *   `server/routes.ts` sert aussi. Une garde au montage y intercepterait les
 *   routes historiques et renverrait 403 à des profils légitimes : la garde
 *   reste donc par route, comme dans `work-order-parts.routes.ts`.
 * - `workOrderItemDetailRoutes` et `laborCatalogRoutes` ont des préfixes qui
 *   leur sont propres : la garde est posée au montage, et couvre d'office toute
 *   route ajoutée plus tard.
 */

/** Le technicien ne travaille que sur les OT qui lui sont assignées. */
async function refusPourCetteOT(workOrderId: number, user: Express.Request["user"]) {
  const workOrder = await storage.getWorkOrder(workOrderId);
  if (!workOrder) {
    return { status: 404, message: "Ordre de travail non trouvé" };
  }

  if (user?.role === "technician" && workOrder.technicianId && workOrder.technicianId !== user.id) {
    return { status: 403, message: "Accès refusé - OT assignée à un autre technicien" };
  }

  // Un OT clos est figé : ses heures ne bougent plus (reprise par le contrôle qualité seulement).
  if (workOrder.status === "completed") {
    return {
      status: 409,
      message: "Cet ordre de travail est terminé : ses lignes de travail ne se modifient plus. Pour le reprendre, passez par le contrôle qualité.",
    };
  }
  if (workOrder.status === "cancelled") {
    return { status: 409, message: "Cet ordre de travail est annulé : ses lignes de travail ne se modifient plus." };
  }

  return null;
}

function diffuser(event: string, payload: Record<string, unknown>) {
  const broadcast = (global as any).broadcastUpdate;
  if (typeof broadcast === "function") {
    broadcast(event, { ...payload, scope: workOrderStaffScope() });
  }
}

// --- Monté sur /work-orders ------------------------------------------------

export const workOrderItemsRoutes = Router();

workOrderItemsRoutes.get("/:workOrderId/items", isAnyUser, async (req, res, next) => {
  try {
    const workOrderId = parseRouteId(req.params.workOrderId, WORK_ORDER_ID_INVALID_MESSAGE);

    await assertWorkOrderReadable(req.user, workOrderId);
    return res.status(200).json(await workOrderItemsService.getItemsForWorkOrder(workOrderId));
  } catch (error) {
    if (isAppError(error)) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Get work order items error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

workOrderItemsRoutes.post("/:workOrderId/items", isTechnician, async (req, res, next) => {
  try {
    const workOrderId = parseRouteId(req.params.workOrderId, WORK_ORDER_ID_INVALID_MESSAGE);

    const refus = await refusPourCetteOT(workOrderId, req.user);
    if (refus) {
      return res.status(refus.status).json({ message: refus.message });
    }

    const resultat = await workOrderItemsService.createItem(workOrderId, req.body ?? {}, req.user?.id);
    if (!resultat.success) {
      return res.status(400).json({ message: resultat.error });
    }

    diffuser("work_order_item_changed", {
      workOrderId,
      action: "created",
      totals: resultat.data.totals,
      actor: req.user ? { userId: req.user.id, role: req.user.role, username: req.user.username } : null,
    });

    return res.status(201).json(resultat.data);
  } catch (error) {
    if (isAppError(error)) return next(error);
    console.error("Create work order item error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// --- Monté sur /work-order-items (garde isTechnician au montage) -----------

export const workOrderItemDetailRoutes = Router();

workOrderItemDetailRoutes.patch("/:id", async (req, res, next) => {
  try {
    const itemId = parseRouteId(req.params.id, ITEM_ID_INVALID_MESSAGE);

    const ligne = await workOrderItemsService.getItem(itemId);
    if (!ligne) {
      return res.status(404).json({ message: "Ligne de travail introuvable" });
    }

    const refus = await refusPourCetteOT(ligne.workOrderId, req.user);
    if (refus) {
      return res.status(refus.status).json({ message: refus.message });
    }

    const resultat = await workOrderItemsService.updateItem(itemId, req.body ?? {});
    if (!resultat.success) {
      return res.status(400).json({ message: resultat.error });
    }

    diffuser("work_order_item_changed", {
      workOrderId: resultat.data.workOrderId,
      action: "updated",
      itemId,
      totals: resultat.data.totals,
      actor: req.user ? { userId: req.user.id, role: req.user.role, username: req.user.username } : null,
    });

    return res.status(200).json(resultat.data);
  } catch (error) {
    if (isAppError(error)) return next(error);
    console.error("Update work order item error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

workOrderItemDetailRoutes.delete("/:id", async (req, res, next) => {
  try {
    const itemId = parseRouteId(req.params.id, ITEM_ID_INVALID_MESSAGE);

    const ligne = await workOrderItemsService.getItem(itemId);
    if (!ligne) {
      return res.status(404).json({ message: "Ligne de travail introuvable" });
    }

    const refus = await refusPourCetteOT(ligne.workOrderId, req.user);
    if (refus) {
      return res.status(refus.status).json({ message: refus.message });
    }

    const resultat = await workOrderItemsService.deleteItem(itemId);
    if (!resultat.success) {
      return res.status(400).json({ message: resultat.error });
    }

    diffuser("work_order_item_changed", {
      workOrderId: resultat.data.workOrderId,
      action: "deleted",
      itemId,
      totals: resultat.data.totals,
      actor: req.user ? { userId: req.user.id, role: req.user.role, username: req.user.username } : null,
    });

    return res.status(200).json(resultat.data);
  } catch (error) {
    if (isAppError(error)) return next(error);
    console.error("Delete work order item error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// --- Monté sur /labor-catalog ----------------------------------------------

export const laborCatalogRoutes = Router();

// Barème interne (heures standard, taux) : personnel seulement ; un client ne le lit pas.
laborCatalogRoutes.get("/", isStaff, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "1";
    return res.status(200).json(await workOrderItemsService.getLaborCatalog(includeInactive));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get labor catalog error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/** Écriture du référentiel : la garde `isWorkshopManager` est posée au montage. */
export const laborCatalogWriteRoutes = Router();

laborCatalogWriteRoutes.post("/", async (req, res) => {
  try {
    const resultat = await workOrderItemsService.createLaborCatalogEntry(req.body ?? {}, req.user?.id);
    if (!resultat.success) {
      return res.status(400).json({ message: resultat.error });
    }

    return res.status(201).json(resultat.data);
  } catch (error) {
    console.error("Create labor catalog entry error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

laborCatalogWriteRoutes.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "Identifiant de poste invalide.");
    const resultat = await workOrderItemsService.updateLaborCatalogEntry(id, req.body ?? {}, req.user?.id);
    if (!resultat.success) throw new AppError(400, resultat.error);
    return res.status(200).json(resultat.data);
  } catch (error) {
    return next(error);
  }
});
