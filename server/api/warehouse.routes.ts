import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { stockAlertsService } from "../services/stock-alerts-service";

const log = moduleLogger("warehouse-routes");

const router = Router();

const broadcastWarehouseUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    partId?: number | null;
    actorUserId?: number | null;
    actorRole?: string | null;
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    version: 1,
    entity: "warehouse",
    entityId: options?.partId ?? null,
    payload,
    scope: { type: "broadcast" },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

/**
 * Routes API Warehouse & Stock Alerts
 * Exploitation des 58 pièces détachées (94,4M FCFA)
 */

// Note: Authentication is applied individually on each route

// Valeur totale de l'inventaire
router.get("/inventory-value", authenticate, async (req: Request, res: Response) => {
  try {
    const inventoryValue = await stockAlertsService.getInventoryValue();
    return res.status(200).json(inventoryValue);
  } catch (error) {
    console.error("Get inventory value error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Alertes de réapprovisionnement actives (38 alertes)
router.get("/reorder-alerts", authenticate, async (_req: Request, res: Response) => {
  try {
    const alerts = await stockAlertsService.getReorderAlerts();
    return res.status(200).json(alerts);
  } catch (error) {
    console.error("Get reorder alerts error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Stock réel d'une pièce avec historique mouvements
router.get("/parts/:id/real-stock", authenticate, async (req: Request, res: Response) => {
  try {
    const partId = parseInt(req.params.id);

    if (isNaN(partId)) {
      return res.status(400).json({ message: "ID de pièce invalide" });
    }

    const realStock = await stockAlertsService.getRealStock(partId);

    return res.status(200).json(realStock);
  } catch (error) {
    console.error("Get real stock error:", error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Erreur serveur"
    });
  }
});

// Enregistrer un mouvement de stock (ENTRÉE/SORTIE)
// Note: isWorkshopManager removed - auth handled at router level
router.post("/stock-movement", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partId, type, quantity, reason, workOrderId, responsiblePerson, deliveryReceiptNumber } = req.body;

    if (!partId || !type || !quantity || !reason) {
      return res.status(400).json({ message: "Données incomplètes" });
    }

    if (!['in', 'out'].includes(type)) {
      return res.status(400).json({ message: "Type de mouvement invalide (in/out)" });
    }

    const movement = await stockAlertsService.recordStockMovement({
      partId: parseInt(partId),
      type: type as 'in' | 'out',
      quantity: parseFloat(quantity),
      reason,
      workOrderId: workOrderId ? parseInt(workOrderId) : undefined,
      responsiblePerson,
      deliveryReceiptNumber,
      userId: (req as any).session.userId
    });

    broadcastWarehouseUpdate(
      "warehouse_stock_movement_recorded",
      {
        movement,
        partId: parseInt(partId),
        movementType: type,
        quantity: parseFloat(quantity),
      },
      {
        partId: parseInt(partId),
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );

    return res.status(201).json(movement);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Record stock movement error");
    return next(new AppError(500, "Erreur serveur", { cause: error }));
  }
});

// Pièces les plus utilisées (top N)
router.get("/most-used-parts", authenticate, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const mostUsedParts = await stockAlertsService.getMostUsedParts(limit);

    return res.status(200).json(mostUsedParts);
  } catch (error) {
    console.error("Get most used parts error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques globales du magasin
router.get("/statistics", authenticate, async (_req: Request, res: Response) => {
  try {
    const statistics = await stockAlertsService.getWarehouseStatistics();

    return res.status(200).json(statistics);
  } catch (error) {
    console.error("Get warehouse statistics error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Pièces par fournisseur avec valeur totale
router.get("/parts-by-supplier", authenticate, async (_req: Request, res: Response) => {
  try {
    const partsBySupplier = await stockAlertsService.getPartsBySupplier();

    return res.status(200).json(partsBySupplier);
  } catch (error) {
    console.error("Get parts by supplier error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Pièces les plus consommées pour graphique
router.get("/top-consumed-parts", authenticate, async (req: Request, res: Response) => {
  try {
    console.log('🔐 [AUTH] GET /top-consumed-parts - Session exists:', !!req.session, 'UserId:', (req as any).session?.userId);
    const limit = parseInt(req.query.limit as string) || 10;
    const topConsumed = await stockAlertsService.getTopConsumedParts(limit);

    console.log(`📊 Top consumed parts (${topConsumed.length} items):`, topConsumed);
    return res.status(200).json(topConsumed);
  } catch (error) {
    console.error("Get top consumed parts error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Historique de la valeur du stock
router.get("/stock-value-history", authenticate, async (req: Request, res: Response) => {
  try {
    console.log('🔐 [AUTH] GET /stock-value-history - Session exists:', !!req.session, 'UserId:', (req as any).session?.userId);
    const days = parseInt(req.query.days as string) || 30;
    const history = await stockAlertsService.getStockValueHistory(days);

    console.log(`📈 Stock value history (${history.length} days):`, history.slice(0, 3));
    return res.status(200).json(history);
  } catch (error) {
    console.error("Get stock value history error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
