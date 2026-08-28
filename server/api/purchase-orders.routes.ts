import { Router, Request, Response, NextFunction } from "express";
import { procurementService } from "../services/procurement-service";
import { z } from "zod";

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
    throw new Error("Commande introuvable");
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
 * Middleware pour vérifier l'authentification
 */
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  
  // Attach minimal user info for use in routes
  req.user = {
    id: req.session.userId,
    username: req.session.username || '',
    role: req.session.role || 'user',
  };
  
  next();
};

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

/**
 * GET /api/purchase-orders - Liste des commandes avec filtres
 */
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, supplierId, createdBy, dateFrom, dateTo } = req.query;

    const orders = await procurementService.getPurchaseOrders({
      status: status as string | undefined,
      supplierId: supplierId ? parseInt(supplierId as string) : undefined,
      createdBy: createdBy ? parseInt(createdBy as string) : undefined,
      dateFrom: dateFrom as string | undefined,
      dateTo: dateTo as string | undefined,
    });

    res.json(orders);
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des commandes:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération des commandes",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/purchase-orders/statistics - Statistiques des commandes
 */
router.get("/statistics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const stats = await procurementService.getOrderStatistics(
      dateFrom as string | undefined,
      dateTo as string | undefined
    );

    res.json(stats);
  } catch (error) {
    console.error("❌ Erreur lors du calcul des statistiques:", error);
    res.status(500).json({
      error: "Erreur lors du calcul des statistiques",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/purchase-orders/group-suggestions - Suggestions de regroupement
 * Analyse les demandes en attente et suggère des commandes groupées
 */
router.get("/group-suggestions", requireAuth, checkWritePermission, async (req: Request, res: Response) => {
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
    console.error("❌ Erreur lors du regroupement des demandes:", error);
    res.status(500).json({
      error: "Erreur lors du regroupement des demandes",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/purchase-orders/optimize-timing/:supplierId - Optimisation du timing
 * Suggère le meilleur moment pour passer commande
 */
router.post("/optimize-timing/:supplierId", requireAuth, checkWritePermission, async (req: Request, res: Response) => {
  try {
    const supplierId = parseInt(req.params.supplierId);

    const optimization = await procurementService.optimizeOrderTiming(supplierId);

    res.json(optimization);
  } catch (error) {
    console.error("❌ Erreur lors de l'optimisation du timing:", error);
    res.status(500).json({
      error: "Erreur lors de l'optimisation du timing",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/purchase-orders/overdue - Liste des commandes en retard
 * Identifie automatiquement les commandes dont la date de livraison est dépassée
 * IMPORTANT: Doit être AVANT /:id pour éviter conflit de route
 */
router.get("/overdue", requireAuth, async (req: Request, res: Response) => {
  try {
    console.log("🚨 Requête de vérification des commandes en retard");
    
    const overdueOrders = await procurementService.getOverdueOrders();
    
    res.json(overdueOrders);
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des commandes en retard:", error);
    
    res.status(500).json({
      error: "Erreur lors de la récupération des commandes en retard",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/purchase-orders/:id - Détails d'une commande
 */
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id);
    const orderDetails = await procurementService.getPurchaseOrderById(orderId);

    if (!orderDetails) {
      return res.status(404).json({ error: "Commande non trouvée" });
    }

    res.json(orderDetails);
  } catch (error) {
    console.error("❌ Erreur lors de la récupération de la commande:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération de la commande",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/purchase-orders - Créer une commande
 */
router.post("/", requireAuth, checkWritePermission, async (req: Request, res: Response) => {
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
      discountPercentage: z.number().optional(),
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
    console.error("❌ Erreur lors de la création de la commande:", error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors
      });
    }

    res.status(500).json({
      error: "Erreur lors de la création de la commande",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PATCH /api/purchase-orders/:id/status - Changer le statut
 */
router.patch("/:id/status", requireAuth, checkWritePermission, async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: "ID de commande invalide" });
    }

    const scope = await getScopeByOrderId(orderId);
    if (!canManageScope(req.user?.role, scope)) {
      return denyByScope(res, scope);
    }

    const schema = z.object({
      status: z.enum(['draft', 'sent', 'confirmed', 'cancellation_requested', 'partial', 'delivered', 'completed', 'cancelled']),
      deliveryCode: z.string().optional(), // Code de livraison optionnel
      cancellationReason: z.string().optional(),
    });

    const { status, deliveryCode, cancellationReason } = schema.parse(req.body);

    // Réception (partielle ou complète) = magasinier ou admin uniquement
    if ((status === "partial" || status === "delivered") && !canRecordDelivery(req.user?.role)) {
      return res.status(403).json({
        error: "Accès refusé",
        message: "Seuls le magasinier et l'administrateur peuvent enregistrer la livraison",
      });
    }

    // Si on passe en "delivered", le code de livraison est obligatoire
    if (status === 'delivered' && !deliveryCode) {
      return res.status(400).json({
        error: "Code de livraison requis",
        message: "Veuillez fournir un code de livraison pour confirmer la réception"
      });
    }

    if (status === "cancellation_requested" && !cancellationReason?.trim()) {
      return res.status(400).json({
        error: "Motif requis",
        message: "Veuillez renseigner le motif d'annulation fournisseur",
      });
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
    console.error("❌ Erreur lors de la mise à jour du statut:", error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors
      });
    }

    if (error instanceof Error) {
      if (error.message.includes("Commande introuvable")) {
        return res.status(404).json({
          error: "Commande introuvable",
          details: error.message,
        });
      }

      if (error.message.includes("Transition de statut invalide")) {
        return res.status(400).json({
          error: "Transition de statut invalide",
          details: error.message,
        });
      }

      if (error.message.includes("Clôture impossible")) {
        return res.status(400).json({
          error: "Clôture impossible",
          details: error.message,
        });
      }
    }

    res.status(500).json({
      error: "Erreur lors de la mise à jour du statut",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PATCH /api/purchase-orders/:id/lines/:lineId - Mettre à jour une ligne
 * Utile pour la réception et le contrôle qualité
 */
router.patch("/:id/lines/:lineId", requireAuth, checkWritePermission, async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: "ID de commande invalide" });
    }

    const scope = await getScopeByOrderId(orderId);
    if (!canManageScope(req.user?.role, scope)) {
      return denyByScope(res, scope);
    }

    const lineId = parseInt(req.params.lineId);
    
    const schema = z.object({
      quantityReceived: z.number().optional(),
      quantityAccepted: z.number().optional(),
      quantityRejected: z.number().optional(),
      deliveryStatus: z.enum(['pending', 'partial', 'delivered', 'accepted', 'rejected']).optional(),
    });

    const data = schema.parse(req.body);

    const updated = await procurementService.updateOrderLine(lineId, data, req.user?.id);

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
    console.error("❌ Erreur lors de la mise à jour de la ligne:", error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors
      });
    }

    if (error instanceof Error && error.message.includes("Commande introuvable")) {
      return res.status(404).json({
        error: "Commande introuvable",
        details: error.message,
      });
    }

    res.status(500).json({
      error: "Erreur lors de la mise à jour de la ligne",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
