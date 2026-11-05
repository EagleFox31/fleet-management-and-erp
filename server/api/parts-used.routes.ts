import { Router } from "express";
import { workOrderCostScope } from "../lib/work-order-realtime-scope";
import { WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authorize, isStockIssuer } from "../middleware/auth";
import { parseRouteId } from "../lib/route-id";
import { removePartUsed } from "../services/part-used-removal";
import { storage } from "../storage";

const router = Router();

// Liste des pièces posées avec leur prix unitaire : rôles coût seulement (hors chauffeur).
router.get("/", authorize([...WORK_ORDER_COST_READ_ROLES]), async (_req, res, next) => {
  try {
    return res.status(200).json(await storage.getAllPartsUsed());
  } catch (error) {
    next(error);
  }
});

// Retrait d'une pièce posée sur un OT : elle revient en stock (mouvement d'entrée attribué
// à l'acteur). Magasin et atelier seulement : le technicien demande la pièce, il ne la
// remet pas en stock.
router.delete("/:id", isStockIssuer, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "ID de pièce utilisée invalide");
    const removal = await removePartUsed(id, req.user?.id);

    const broadcastUpdate = (global as any).broadcastUpdate;
    if (typeof broadcastUpdate === "function") {
      broadcastUpdate("part_used_removed", {
        entity: "work_order",
        entityId: removal.workOrderId,
        scope: workOrderCostScope(),
        partUsedId: removal.partUsedId,
        workOrderId: removal.workOrderId,
        partId: removal.partId,
      });
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
