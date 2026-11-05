import { Router } from "express";
import { workOrderCostScope } from "../lib/work-order-realtime-scope";
import { isStockIssuer } from "../middleware/auth";
import { parseRouteId } from "../lib/route-id";
import { removePartUsed } from "../services/part-used-removal";

const router = Router();

// Retrait d'une pièce posée sur un OT : elle revient en stock (mouvement d'entrée attribué
// à l'acteur). Magasin et atelier seulement : le technicien demande la pièce, il ne la
// remet pas en stock. La garde est posée sur la route : `GET /api/parts-used` reste à routes.ts.
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
