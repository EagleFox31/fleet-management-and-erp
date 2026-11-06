import { Router, Request, Response, NextFunction } from "express";
import { authenticate, isPartsCatalogManager, isStockValuationReader } from "../middleware/auth";
import { STOCK_VALUATION_READ_ROLES } from "@shared/constants/roles";
import { stockAlertsService } from "../services/stock-alerts-service";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { assertValidDbId } from "../lib/work-order-scope";

const router = Router();
const log = moduleLogger("warehouse-routes");

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
    // Stock et prix : le personnel qui lit le stock, ni chauffeur ni client (AGENTS.md §11).
    scope: { type: "roles", roles: [...STOCK_VALUATION_READ_ROLES] },
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
router.get("/inventory-value", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    const inventoryValue = await stockAlertsService.getInventoryValue();
    return res.status(200).json(inventoryValue);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get inventory value error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Alertes de réapprovisionnement actives (38 alertes)
router.get("/reorder-alerts", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    const alerts = await stockAlertsService.getReorderAlerts();
    return res.status(200).json(alerts);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get reorder alerts error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Stock réel d'une pièce avec historique mouvements
router.get("/parts/:id/real-stock", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partId = parseRouteId(req.params.id, "ID de pièce invalide");

    const realStock = await stockAlertsService.getRealStock(partId);

    return res.status(200).json(realStock);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Get real stock error");
    return next(new AppError(500, "Erreur serveur", { cause: error }));
  }
});

// Enregistrer un mouvement de stock (ENTRÉE/SORTIE)
// Écriture de stock : magasin seul (admin, warehouse). Le montage `isStaff` ne suffit pas : un
// chauffeur ou une secrétaire écrivait un mouvement. Le chef d'atelier sort une pièce par
// `POST /api/work-orders/:id/part-requirements/:id/issue` (dérogation motivée), pas ici ; le
// technicien demande, il ne sort pas. Aucun écran n'appelle cette route aujourd'hui.
router.post("/stock-movement", authenticate, isPartsCatalogManager, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partId: rawPartId, type, quantity: rawQuantity, reason, workOrderId: rawWorkOrderId, responsiblePerson, deliveryReceiptNumber } = req.body ?? {};

    if (rawPartId === undefined || rawPartId === null || !type || rawQuantity === undefined || rawQuantity === null || !reason) {
      throw new AppError(400, "Données incomplètes");
    }
    if (!["in", "out"].includes(type)) {
      throw new AppError(400, "Type de mouvement invalide (in/out)");
    }
    const partId = Number(rawPartId);
    assertValidDbId(partId, "ID de pièce invalide");
    const quantity = Number(rawQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(400, "La quantité doit être un entier strictement positif.");
    }
    let workOrderId: number | undefined;
    if (rawWorkOrderId !== undefined && rawWorkOrderId !== null && rawWorkOrderId !== "") {
      workOrderId = Number(rawWorkOrderId);
      assertValidDbId(workOrderId, "ID d'ordre de travail invalide.");
    }
    if (typeof reason !== "string") {
      throw new AppError(400, "Le motif du mouvement est invalide.");
    }

    const movement = await stockAlertsService.recordStockMovement({
      partId,
      type: type as "in" | "out",
      quantity,
      reason,
      workOrderId,
      responsiblePerson,
      deliveryReceiptNumber,
      userId: req.user!.id,
    });

    broadcastWarehouseUpdate(
      "warehouse_stock_movement_recorded",
      { movement, partId, movementType: type, quantity },
      { partId, actorUserId: req.user!.id, actorRole: req.user!.role },
    );

    return res.status(201).json(movement);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Record stock movement error");
    return next(new AppError(500, "Erreur serveur", { cause: error }));
  }
});

// Pièces les plus utilisées (top N)
router.get("/most-used-parts", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const mostUsedParts = await stockAlertsService.getMostUsedParts(limit);

    return res.status(200).json(mostUsedParts);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get most used parts error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques globales du magasin
router.get("/statistics", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    const statistics = await stockAlertsService.getWarehouseStatistics();

    return res.status(200).json(statistics);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get warehouse statistics error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Pièces par fournisseur avec valeur totale
router.get("/parts-by-supplier", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    const partsBySupplier = await stockAlertsService.getPartsBySupplier();

    return res.status(200).json(partsBySupplier);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get parts by supplier error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Pièces les plus consommées pour graphique
router.get("/top-consumed-parts", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    log.debug({ userId: req.session?.userId, requestId: req.requestId }, "GET /top-consumed-parts");
    const limit = parseInt(req.query.limit as string) || 10;
    const topConsumed = await stockAlertsService.getTopConsumedParts(limit);

    log.debug({ items: topConsumed.length, requestId: req.requestId }, "Top consumed parts");
    return res.status(200).json(topConsumed);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get top consumed parts error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Historique de la valeur du stock
router.get("/stock-value-history", authenticate, isStockValuationReader, async (req: Request, res: Response) => {
  try {
    log.debug({ userId: req.session?.userId, requestId: req.requestId }, "GET /stock-value-history");
    const days = parseInt(req.query.days as string) || 30;
    const history = await stockAlertsService.getStockValueHistory(days);

    log.debug({ days: history.length, requestId: req.requestId }, "Stock value history");
    return res.status(200).json(history);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get stock value history error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
