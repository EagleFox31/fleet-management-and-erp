import { Router, Request, Response, NextFunction } from "express";
import { procurementService } from "../services/procurement-service";
import { z } from "zod";
import { AppError, isAppError } from "../lib/app-error";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { isAnyUser } from "../middleware/auth";
import { PURCHASE_ORDER_STATUSES } from "@shared/constants/purchase-order-statuses";
import { withLogContext } from "../lib/error-log-context";

const log = moduleLogger("purchase-orders");

const router = Router();
type PurchaseOrderScope = "parts" | "non_parts";

const PARTS_SCOPE_ROLES = ["admin", "warehouse", "secretary"] as const;
const NON_PARTS_SCOPE_ROLES = ["admin", "warehouse", "secretary", "logistics"] as const;
const ANY_PROCUREMENT_ROLES = ["admin", "warehouse", "secretary", "logistics"] as const;
const DELIVERY_RECORD_ROLES = ["admin", "warehouse"] as const;

const SCOPE_LABELS: Record<PurchaseOrderScope, string> = {
  parts: "commandes liées aux pièces atelier",
  non_parts: "commandes hors pièces atelier",
};

const getAllowedRolesForScope = (scope: PurchaseOrderScope): readonly string[] =>
  scope === "parts" ? PARTS_SCOPE_ROLES : NON_PARTS_SCOPE_ROLES;

const canManageScope = (role: string | undefined, scope: PurchaseOrderScope): boolean => {
  if (!role) return false;
  return getAllowedRolesForScope(scope).includes(role);
};

const canRecordDelivery = (role: string | undefined): boolean => {
  if (!role) return false;
  return DELIVERY_RECORD_ROLES.includes(role as (typeof DELIVERY_RECORD_ROLES)[number]);
};

const denyByScope = (res: Response, scope: PurchaseOrderScope) =>
  res.status(403).json({
    error: "Accès refusé",
    message: `Vous n'avez pas les droits pour gérer les ${SCOPE_LABELS[scope]}`,
  });

const inferScopeFromCreatePayload = (data: {
  requirementIds?: number[];
}): PurchaseOrderScope => (data.requirementIds?.length ? "parts" : "non_parts");

const inferScopeFromOrderDetails = (orderDetails: any): PurchaseOrderScope => {
  const isPartsOrder = Array.isArray(orderDetails?.lines)
    && orderDetails.lines.some((line: any) => Boolean(line?.part || line?.requirement));

  return isPartsOrder ? "parts" : "non_parts";
};

const getScopeByOrderId = async (orderId: number): Promise<PurchaseOrderScope> => {
  const orderDetails = await procurementService.getPurchaseOrderById(orderId);
  if (!orderDetails) {
    throw new AppError(404, "Commande introuvable.");
  }
  return inferScopeFromOrderDetails(orderDetails);
};

const broadcastPurchaseOrderUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    entityId?: number | null;
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
    entity: "purchase_order",
    entityId: options?.entityId ?? null,
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
 * Authentification : `isAnyUser` relit le compte en base et pose `req.user` avec le rôle COURANT.
 * Avant, `req.user.role` était recopié de la session : un magasinier passé logisticien par
 * l'admin gardait ses droits de magasinier tant que sa session durait (ADM2-3).
 */
const requireAuth = isAnyUser;

/**
 * Middleware pour vérifier les droits de création/modification
 * Accessible par : admin, secretary, warehouse, logistics
 */
const checkWritePermission = (req: Request, res: Response, next: NextFunction) => {
  const allowedRoles: string[] = [...ANY_PROCUREMENT_ROLES];
  
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      error: "Accès refusé",
      message: "Vous n'avez pas les droits pour effectuer cette action"
    });
  }
  
  next();
};

/**
 * Middleware pour vérifier les droits d'approbation
 * Accessible par : admin, secretary, warehouse, logistics
 */
const checkApprovalPermission = (req: Request, res: Response, next: NextFunction) => {
  const allowedRoles: string[] = [...ANY_PROCUREMENT_ROLES];
  
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      error: "Accès refusé",
      message: "Seuls les administrateurs, secrétaires, magasiniers et achats peuvent approuver les commandes"
    });
  }
  
  next();
};

/** Identifiant d'URL : entier positif, sinon 400 lisible (avant : NaN jusqu'à la base, 500). */
const parseIdParam = (value: string, label: string): number => {
  return parseRouteId(value, `${label} invalide.`);
};

/**
 * GET /api/purchase-orders - Liste des commandes avec filtres
 */
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, supplierId, createdBy, dateFrom, dateTo } = req.query;

    const orders = await procurementService.getPurchaseOrders({
      status: status as string | undefined,
      supplierId: parseQueryId(supplierId, "ID fournisseur invalide"),
      createdBy: parseQueryId(createdBy, "ID d'utilisateur invalide"),
      dateFrom: dateFrom as string | undefined,
      dateTo: dateTo as string | undefined,
    });

    res.json(orders);
  } catch (error) {
    next(withLogContext(error, { event: "récupération des commandes" }));
  }
});

/**
 * GET /api/purchase-orders/statistics - Statistiques des commandes
 */
router.get("/statistics", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const stats = await procurementService.getOrderStatistics(
      dateFrom as string | undefined,
      dateTo as string | undefined
    );

    res.json(stats);
  } catch (error) {
    next(withLogContext(error, { event: "calcul des statistiques" }));
  }
});

/**
 * GET /api/purchase-orders/group-suggestions - Suggestions de regroupement
 * Analyse les demandes en attente et suggère des commandes groupées
 */
router.get("/group-suggestions", requireAuth, checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!canManageScope(req.user?.role, "parts")) {
      return denyByScope(res, "parts");
    }

    const { minRequirements, maxDaysOld, urgencyThreshold } = req.query;

    const suggestions = await procurementService.groupRequestsBySupplier({
      minRequirements: minRequirements ? parseInt(minRequirements as string) : undefined,
      maxDaysOld: maxDaysOld ? parseInt(maxDaysOld as string) : undefined,
      urgencyThreshold: urgencyThreshold as 'low' | 'medium' | 'high' | 'critical' | undefined,
    });

    res.json(suggestions);
  } catch (error) {
    next(withLogContext(error, { event: "regroupement des demandes" }));
  }
});

/**
 * POST /api/purchase-orders/optimize-timing/:supplierId - Optimisation du timing
 * Suggère le meilleur moment pour passer commande
 */
router.post("/optimize-timing/:supplierId", requireAuth, checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplierId = parseIdParam(req.params.supplierId, "Identifiant de fournisseur");

    const optimization = await procurementService.optimizeOrderTiming(supplierId);

    res.json(optimization);
  } catch (error) {
    next(withLogContext(error, { event: "optimisation du timing" }));
  }
});

/**
 * GET /api/purchase-orders/overdue - Liste des commandes en retard
 * Identifie automatiquement les commandes dont la date de livraison est dépassée
 * IMPORTANT: Doit être AVANT /:id pour éviter conflit de route
 */
router.get("/overdue", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    log.debug({ requestId: req.requestId }, "vérification des commandes en retard");

    const overdueOrders = await procurementService.getOverdueOrders();

    res.json(overdueOrders);
  } catch (error) {
    next(withLogContext(error, { event: "commandes en retard" }));
  }
});

/**
 * GET /api/purchase-orders/:id - Détails d'une commande
 */
router.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = parseIdParam(req.params.id, "Identifiant de commande");
    const orderDetails = await procurementService.getPurchaseOrderById(orderId);

    if (!orderDetails) {
      throw new AppError(404, "Commande introuvable.");
    }

    res.json(orderDetails);
  } catch (error) {
    next(withLogContext(error, { event: "récupération de la commande" }));
  }
});

/**
 * POST /api/purchase-orders - Créer une commande
 */
router.post("/", requireAuth, checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Valider les données de base
    const schema = z.object({
      supplierId: z.number(),
      requirementIds: z.array(z.number()).optional().default([]),
      requirementQuantities: z.array(z.object({
        requirementId: z.number(),
        quantityOrdered: z.number().int().positive(),
      })).optional().default([]),
      manualLines: z.array(z.object({
        description: z.string(),
        quantityOrdered: z.number().positive(),
        unitPrice: z.number().positive(),
      })).optional().default([]),
      // Remise bornée : hors de 0..100, le total deviendrait négatif ou gonflé.
      discountPercentage: z.number().min(0, "La remise ne peut pas être négative.").max(100, "La remise ne peut pas dépasser 100 %.").optional(),
      notes: z.string().optional(),
      urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    }).refine(
      (data) => data.requirementIds.length > 0 || data.manualLines.length > 0,
      { message: "Au moins une demande ou une ligne manuelle est requise" }
    );

    const data = schema.parse(req.body);
    const scope = inferScopeFromCreatePayload(data);

    if (!canManageScope(req.user?.role, scope)) {
      return denyByScope(res, scope);
    }

    const order = await procurementService.createPurchaseOrder({
      ...data,
      createdBy: req.user!.id,
    });

    broadcastPurchaseOrderUpdate(
      "purchase_order_created",
      {
        order,
        scope,
      },
      {
        entityId: typeof order?.id === "number" ? order.id : null,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.status(201).json(order);
  } catch (error) {
    // Erreurs normalisées par le gestionnaire central : jamais de détail technique.
    next(withLogContext(error, { event: "création de commande" }));
  }
});

/**
 * PATCH /api/purchase-orders/:id/status - Changer le statut
 * Erreurs au contrat commun : 400 saisie, 404 commande inconnue, 409 transition
 * ou clôture refusée (AppError du service, libellés d'écran).
 */
const updateOrderStatusSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES),
  deliveryCode: z.string().optional(), // Code de livraison optionnel
  cancellationReason: z.string().optional(),
});

router.patch("/:id/status", requireAuth, checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = parseIdParam(req.params.id, "Identifiant de commande");

    const scope = await getScopeByOrderId(orderId);
    if (!canManageScope(req.user?.role, scope)) {
      return denyByScope(res, scope);
    }

    const { status, deliveryCode, cancellationReason } = updateOrderStatusSchema.parse(req.body);

    // Réception (partielle ou complète) = magasinier ou admin uniquement
    if ((status === "partial" || status === "delivered") && !canRecordDelivery(req.user?.role)) {
      return res.status(403).json({
        error: "Accès refusé",
        message: "Seuls le magasinier et l'administrateur peuvent enregistrer la livraison",
      });
    }

    // Si on passe en "delivered", le code de livraison est obligatoire
    if (status === 'delivered' && !deliveryCode) {
      throw new AppError(400, "Veuillez fournir un code de livraison pour confirmer la réception.");
    }

    if (status === "cancellation_requested" && !cancellationReason?.trim()) {
      throw new AppError(400, "Veuillez renseigner le motif d'annulation fournisseur.");
    }

    const updated = await procurementService.updateOrderStatus(
      orderId,
      status,
      req.user!.id,
      deliveryCode,
      cancellationReason
    );

    broadcastPurchaseOrderUpdate(
      "purchase_order_status_updated",
      {
        orderId,
        status,
        scope,
        updated,
      },
      {
        entityId: orderId,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.json(updated);
  } catch (error) {
    // ZodError -> 400 par champ, AppError -> son statut, le reste -> 500 générique avec référence.
    next(withLogContext(error, { event: "mise à jour du statut" }));
  }
});

/**
 * PATCH /api/purchase-orders/:id/lines/:lineId - Mettre à jour une ligne
 * Utile pour la réception et le contrôle qualité
 */
router.patch("/:id/lines/:lineId", requireAuth, checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = parseRouteId(req.params.id, "Commande ou ligne invalide.");
    const lineId = parseRouteId(req.params.lineId, "Commande ou ligne invalide.");

    const scope = await getScopeByOrderId(orderId);
    if (!canManageScope(req.user?.role, scope)) {
      return denyByScope(res, scope);
    }

    // Quantités entières et positives : une quantité reçue négative gonflait le
    // stock à la réception suivante (écart calculé depuis une base négative).
    const quantity = (label: string) =>
      z.number().int(`${label} : nombre entier attendu.`).min(0, `${label} : la quantité ne peut pas être négative.`).optional();
    const schema = z.object({
      quantityReceived: quantity("Quantité reçue"),
      quantityAccepted: quantity("Quantité acceptée"),
      quantityRejected: quantity("Quantité refusée"),
      deliveryStatus: z.enum(['pending', 'partial', 'delivered', 'accepted', 'rejected']).optional(),
    });

    const data = schema.parse(req.body);

    const updated = await procurementService.updateOrderLine(lineId, data, req.user?.id, orderId);

    broadcastPurchaseOrderUpdate(
      "purchase_order_line_updated",
      {
        orderId,
        lineId,
        scope,
        updatedLine: updated,
      },
      {
        entityId: orderId,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.json(updated);
  } catch (error) {
    next(withLogContext(error, { event: "mise à jour de ligne de commande" }));
  }
});

export default router;
