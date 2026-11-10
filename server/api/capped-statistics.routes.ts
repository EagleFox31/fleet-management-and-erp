import { Router, type NextFunction, type Request, type Response } from "express";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError, isAppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { parseReportPeriod } from "../lib/report-period";
import { isInventoryReportReader, isStaff } from "../middleware/auth";
import { storage } from "../storage";
import { parts, partsStockMovements, users, workOrders } from "@shared/schema";

const log = moduleLogger("capped-statistics");

/** Bornes de lecture complète : au-delà, 422 explicite plutôt qu'un résultat tronqué. */
export const INVENTORY_REPORT_MAX_PARTS = 5000;
export const AWAITING_PARTS_MAX = 500;

export interface CappedStatisticsLimits {
  inventoryReportMaxParts: number;
  awaitingPartsMax: number;
}

/**
 * Trois lectures sorties de server/routes.ts (gelé) : elles calculaient sur une lecture plafonnée
 * (50 lignes pour `getWorkOrders()` / `getParts()`, 100 pour awaiting-parts), donc leurs chiffres
 * étaient faux dès le 51e enregistrement. Les bornes sont injectables pour le test.
 */
export function createCappedStatisticsRouter(
  limits: CappedStatisticsLimits = {
    inventoryReportMaxParts: INVENTORY_REPORT_MAX_PARTS,
    awaitingPartsMax: AWAITING_PARTS_MAX,
  },
): Router {
  const router = Router();

  // Comptes par statut sur TOUS les OT (agrégat SQL). `total` = tous statuts confondus.
  router.get("/statistics/work-orders", isStaff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db
        .select({ status: workOrders.status, n: count() })
        .from(workOrders)
        .groupBy(workOrders.status);
      const of = (status: string) => Number(rows.find((row) => row.status === status)?.n ?? 0);
      return res.status(200).json({
        pending: of("pending"),
        inProgress: of("in_progress"),
        completed: of("completed"),
        total: rows.reduce((sum, row) => sum + Number(row.n), 0),
      });
    } catch (error) {
      log.error({ err: error, requestId: req.requestId }, "Get work orders statistics error");
      return next(
        isAppError(error) ? error : new AppError(500, "Les statistiques des ordres de travail sont momentanément indisponibles.", { cause: error }),
      );
    }
  });

  router.get("/reports/inventory", isInventoryReportReader, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = parseReportPeriod(req.query);
      log.info({ startDate, endDate, requestId: req.requestId }, "Generating inventory report");

      // Seuil ou quantité NULL traités comme 0, comme `(quantity || 0) <= (minQuantity || 0)` d'origine.
      const [aggregate] = await db
        .select({
          totalParts: count(),
          totalValue: sql<string>`coalesce(sum(coalesce(${parts.quantity}, 0) * coalesce(${parts.unitPrice}, 0)), 0)`,
          lowStockCount: sql<number>`count(*) filter (where coalesce(${parts.quantity}, 0) <= coalesce(${parts.minQuantity}, 0))`,
        })
        .from(parts);
      const totalParts = Number(aggregate.totalParts);
      if (totalParts > limits.inventoryReportMaxParts) {
        throw new AppError(
          422,
          `Trop de pièces pour un rapport d'inventaire complet (${totalParts}). Affinez le périmètre.`,
        );
      }

      const allParts = await db.select().from(parts).orderBy(desc(parts.createdAt), desc(parts.id));

      const filteredMovements = await db
        .select({
          id: partsStockMovements.id,
          partId: partsStockMovements.partId,
          partName: parts.name,
          partReference: parts.reference,
          movementType: partsStockMovements.movementType,
          quantity: partsStockMovements.quantity,
          previousStock: partsStockMovements.previousStock,
          newStock: partsStockMovements.newStock,
          reason: partsStockMovements.reason,
          notes: partsStockMovements.notes,
          workOrderId: partsStockMovements.workOrderId,
          workOrderTitle: workOrders.title,
          createdAt: partsStockMovements.createdAt,
          date: partsStockMovements.createdAt,
          performedBy: partsStockMovements.createdBy,
          performedByName: users.name,
        })
        .from(partsStockMovements)
        .leftJoin(parts, eq(partsStockMovements.partId, parts.id))
        .leftJoin(workOrders, eq(partsStockMovements.workOrderId, workOrders.id))
        .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
        .where(and(gte(partsStockMovements.createdAt, startDate), lte(partsStockMovements.createdAt, endDate)))
        .orderBy(desc(partsStockMovements.createdAt));

      const movementsByPart = new Map<number, typeof filteredMovements>();
      for (const movement of filteredMovements) {
        const list = movementsByPart.get(movement.partId) ?? [];
        list.push(movement);
        movementsByPart.set(movement.partId, list);
      }
      const enrichedParts = allParts.map((part) => {
        const partMovements = movementsByPart.get(part.id) ?? [];
        const totalMovements = partMovements.reduce((sum, movement) => sum + Math.abs(movement.quantity || 0), 0);
        return { ...part, movementsCount: totalMovements, movements: partMovements };
      });

      return res.status(200).json({
        parts: enrichedParts,
        movements: filteredMovements,
        statistics: {
          totalParts,
          totalValue: Number(aggregate.totalValue),
          lowStockCount: Number(aggregate.lowStockCount),
          totalMovements: filteredMovements.length,
        },
      });
    } catch (error) {
      if (isAppError(error)) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Get inventory report error");
      return next(new AppError(500, "Le rapport d'inventaire est momentanément indisponible.", { cause: error }));
    }
  });

  // OT en attente de pièces (magasinier) : liste complète bornée, pas de troncature silencieuse.
  router.get("/work-orders/awaiting-parts", isStaff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await storage.getWorkOrders("awaiting_parts", undefined, limits.awaitingPartsMax, 0);
      if (result.total > limits.awaitingPartsMax) {
        throw new AppError(422, `Trop d'OT en attente de pièces pour un affichage complet (${result.total}).`);
      }

      if (result.workOrders.length === 0) {
        return res.status(200).json({ workOrders: [], total: result.total });
      }

      // Éviter le N+1: charger les demandes une seule fois pour toutes les OT.
      const allRequests = await storage.getPartRequirements();
      const activeRequestStatuses = new Set(["pending", "approved", "ordered"]);
      const requestsByWorkOrderId = new Map<number, typeof allRequests>();
      for (const request of allRequests) {
        if (!request.workOrderId || !activeRequestStatuses.has(request.status)) continue;
        const existing = requestsByWorkOrderId.get(request.workOrderId) || [];
        existing.push(request);
        requestsByWorkOrderId.set(request.workOrderId, existing);
      }

      // Caches de PROMESSES : avec `Promise.all`, un cache de valeurs n'est pas encore rempli quand
      // les lignes suivantes le lisent, et N OT du même véhicule lançaient N lectures simultanées
      // (pool saturé, 500 au-delà d'une centaine d'OT).
      const vehicleCache = new Map<number, ReturnType<typeof storage.getVehicle>>();
      const technicianCache = new Map<number, ReturnType<typeof storage.getUser>>();
      const cached = <T>(cache: Map<number, Promise<T>>, key: number, load: () => Promise<T>) => {
        let pending = cache.get(key);
        if (!pending) {
          pending = load();
          cache.set(key, pending);
        }
        return pending;
      };

      const enrichedWorkOrders = await Promise.all(
        result.workOrders.map(async (workOrder) => {
          const relatedRequests = requestsByWorkOrderId.get(workOrder.id) || [];
          const vehicle = await cached(vehicleCache, workOrder.vehicleId, () => storage.getVehicle(workOrder.vehicleId));
          const technician = workOrder.technicianId
            ? await cached(technicianCache, workOrder.technicianId, () => storage.getUser(workOrder.technicianId as number))
            : null;

          return {
            ...workOrder,
            vehicle: vehicle
              ? { registrationNumber: vehicle.registrationNumber, brand: vehicle.brand, model: vehicle.model }
              : null,
            technician: technician ? { name: technician.name } : null,
            pendingParts: relatedRequests.map((r) => ({
              requestId: r.id,
              partId: r.partId,
              partName: r.partName,
              partReference: r.partReference,
              quantityNeeded: r.quantityNeeded,
              status: r.status,
              urgency: r.urgency,
              expectedDeliveryDate: r.expectedDeliveryDate,
            })),
            pendingPartsCount: relatedRequests.length,
          };
        }),
      );

      return res.status(200).json({ workOrders: enrichedWorkOrders, total: result.total });
    } catch (error) {
      if (isAppError(error)) return next(error);
      log.error({ err: error, requestId: req.requestId }, "Get awaiting parts work orders error");
      return next(new AppError(500, "La liste des OT en attente de pièces est momentanément indisponible.", { cause: error }));
    }
  });

  return router;
}

export default createCappedStatisticsRouter();
