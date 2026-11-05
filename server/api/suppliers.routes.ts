import { Router, type Request, type Response, type NextFunction } from "express";
import { supplierManagementService } from "../services/supplier-management-service";
import { alertService, AlertService } from "../services/alert-service";
import { insertSupplierSchema } from "../../shared/schema";
import { canRoleEvaluateSupplierCategory } from "../../shared/constants/supplier-categories";
import {
  getSupplierRatingFieldPermissions,
  type SupplierRatingField,
} from "../../shared/constants/supplier-ratings";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { isUniqueViolation } from "../lib/pg-errors";
import { storage } from "../storage";
import type { AppRole } from "@shared/constants/roles";
import { withLogContext } from "../lib/error-log-context";
import { vatBillingService } from "../services/vat-billing-service";

const supplierLog = moduleLogger("suppliers");
const router = Router();

type RatingField = SupplierRatingField;

const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  administrateur: "admin",
  workshop_manager: "workshop_manager",
  gestionnaire_atelier: "workshop_manager",
  "gestionnaire d'atelier": "workshop_manager",
  technician: "technician",
  technicien: "technician",
  secretary: "secretary",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logistics: "logistics",
  logisticien: "logistics",
  warehouse: "warehouse",
  magasinier: "warehouse",
  client: "client",
  user: "user",
};

const normalizeRole = (role: string | null | undefined): AppRole => {
  const normalized = (role || "").trim().toLowerCase();
  return ROLE_ALIASES[normalized] || "user";
};

const getRatingFieldPermissions = (role: AppRole): Record<RatingField, boolean> =>
  getSupplierRatingFieldPermissions(role);

// Middleware pour vérifier les droits d'écriture (admin, secretary et logistics)
const checkWritePermission = async (req: Request & { session: any }, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }

    const normalizedRole = normalizeRole(user.role);

    if (normalizedRole !== 'admin' && normalizedRole !== 'secretary' && normalizedRole !== 'logistics') {
      return res.status(403).json({ 
        error: "Accès refusé", 
        message: "Seuls les administrateurs, secrétaires et logisticiens peuvent effectuer cette action" 
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      role: normalizedRole
    };

    next();
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Error in checkWritePermission middleware" }));
  }
};

// Middleware pour vérifier les droits d'évaluation selon le rôle et la catégorie du fournisseur
const checkEvaluationPermission = async (req: Request & { session: any }, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }

    const supplierId = parseInt(req.params.id);
    
    // Récupérer le fournisseur pour vérifier sa catégorie
    const supplier = await supplierManagementService.getSupplierById(supplierId);
    
    if (!supplier) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    const category = supplier.supplier.category?.toLowerCase() || '';
    const normalizedRole = normalizeRole(user.role);
    
    // Vérification des droits selon le rôle et la catégorie
    const canEvaluate = checkCategoryPermission(normalizedRole, category);
    
    if (!canEvaluate) {
      return res.status(403).json({ 
        error: "Accès refusé", 
        message: `Vous n'avez pas les droits pour évaluer les fournisseurs de catégorie "${supplier.supplier.category}"` 
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      role: normalizedRole
    };

    next();
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Error in checkEvaluationPermission middleware" }));
  }
};

// Fonction pour vérifier si un rôle peut évaluer une catégorie de fournisseur
function checkCategoryPermission(role: AppRole, category: string): boolean {
  return canRoleEvaluateSupplierCategory(role, category);
}

const broadcastSupplierUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    supplierId?: number | null;
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
    entity: "supplier",
    entityId: options?.supplierId ?? null,
    payload,
    scope: { type: "broadcast" },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

// GET /api/suppliers - Récupérer tous les fournisseurs avec filtres optionnels
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: {
      isActive?: boolean;
      category?: string;
      search?: string;
    } = {};

    if (req.query.isActive !== undefined) {
      const rawActive = req.query.isActive;
      if (rawActive !== "true" && rawActive !== "false") {
        throw new AppError(400, "Le filtre isActive doit valoir « true » ou « false ».");
      }
      filters.isActive = rawActive === "true";
    }

    if (req.query.category) {
      filters.category = req.query.category as string;
    }

    if (req.query.search) {
      filters.search = req.query.search as string;
    }

    const suppliers = await supplierManagementService.getSuppliers(filters);
    res.json(suppliers);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des fournisseurs.", { cause: error }), { event: "lecture de la liste des fournisseurs en échec" }));
  }
});

// GET /api/suppliers/top - Récupérer le top des fournisseurs par volume
router.get("/top", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
    const topSuppliers = await supplierManagementService.getTopSuppliersByVolume(limit);
    res.json(topSuppliers);
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération du top fournisseurs", { cause: error }), { event: "Erreur lors de la récupération du top fournisseurs" }));
  }
});

// GET /api/suppliers/summary - Synthèse fournisseurs avec factures (useBilling).
// Déclarée avant /:id, qui la captait (« ID invalide ») : l'ancienne déclaration de routes.ts n'était jamais servie.
router.get("/summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await vatBillingService.getSuppliersSummary());
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération de la synthèse fournisseurs.", { cause: error }), { event: "Get suppliers summary error" }));
  }
});

// GET /api/suppliers/search - Rechercher des fournisseurs
router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const searchTerm = req.query.q as string;
    
    if (!searchTerm) {
      return res.status(400).json({ error: "Le paramètre 'q' est requis pour la recherche" });
    }

    const results = await supplierManagementService.searchSuppliers(searchTerm);
    res.json(results);
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la recherche de fournisseurs", { cause: error }), { event: "Erreur lors de la recherche de fournisseurs" }));
  }
});

// GET /api/suppliers/:id - Récupérer un fournisseur par ID avec statistiques
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const supplier = await supplierManagementService.getSupplierById(id);
    
    if (!supplier) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    res.json(supplier);
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération du fournisseur", { cause: error }), { event: "Erreur lors de la récupération du fournisseur" }));
  }
});

// GET /api/suppliers/:id/performance - Récupérer les performances d'un fournisseur
router.get("/:id/performance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const performance = await supplierManagementService.getSupplierPerformance(id);
    
    if (!performance) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    res.json(performance);
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des performances", { cause: error }), { event: "Erreur lors de la récupération des performances" }));
  }
});

// POST /api/suppliers - Créer un nouveau fournisseur (admin, secretary et logistics)
/**
 * Création de fournisseur: périmètre plus large que la modification.
 *
 * Le magasinier saisit les pièces et doit pouvoir rattacher un nouveau
 * fournisseur sans être bloqué. Il n'obtient que le droit de *créer un nom*
 * (voir la réduction de charge utile dans le handler POST) — la qualification
 * commerciale reste réservée à `admin`, `secretary`, `logistics` via PATCH.
 */
const checkSupplierCreatePermission = async (
  req: Request & { session: any },
  res: Response,
  next: NextFunction,
) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }

    const normalizedRole = normalizeRole(user.role);
    const allowedRoles = ["admin", "secretary", "logistics", "warehouse"];

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(403).json({
        error: "Accès refusé",
        message: "Votre profil ne permet pas de créer un fournisseur",
      });
    }

    req.user = { id: user.id, username: user.username, role: normalizedRole };
    next();
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Error in checkSupplierCreatePermission middleware" }));
  }
};

router.post("/", checkSupplierCreatePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Le magasinier peut *nommer* un fournisseur (il en a besoin pour rattacher
    // une pièce), mais pas renseigner ses données commerciales — délai de
    // paiement, TVA, SIRET, notations restent du ressort de l'administration.
    // On réduit donc sa charge utile au seul nom: la fiche est créée "à
    // compléter", et la secrétaire la qualifie ensuite via PATCH.
    const rawBody =
      req.user?.role === "warehouse"
        ? { name: typeof req.body?.name === "string" ? req.body.name.trim() : "" }
        : req.body;

    // Validation des données avec Zod
    const validatedData = insertSupplierSchema.parse(rawBody);

    const supplier = await supplierManagementService.createSupplier(validatedData, req.user?.id);

    // Fiche créée au nom seul (typiquement par un magasinier depuis le formulaire
    // pièce): prévenir tout de suite l'administration qu'il reste à la qualifier.
    // Le contrôle périodique d'`alertService` relance tant qu'elle est incomplète.
    if (supplier && AlertService.isSupplierIncomplete(supplier)) {
      void alertService
        .notifyIncompleteSupplierCreated(supplier, req.user?.username)
        .catch((error) =>
          supplierLog.error({ err: error, requestId: req.requestId }, "Alerte fiche fournisseur incomplète non émise"),
        );
    }

    broadcastSupplierUpdate(
      "supplier_created",
      { supplier },
      {
        supplierId: typeof supplier?.id === "number" ? supplier.id : null,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );
    res.status(201).json(supplier);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Données invalides",
        details: error.errors 
      });
    }
    
    if (isUniqueViolation(error)) {
      return next(new AppError(409, "Un fournisseur porte déjà ce nom", { cause: error }));
    }

    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la création du fournisseur", { cause: error }), { event: "Erreur lors de la création du fournisseur" }));
  }
});

// PATCH /api/suppliers/:id - Mettre à jour un fournisseur (admin, secretary et logistics)
router.patch("/:id", checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    // Validation partielle des données
    const partialSchema = insertSupplierSchema.partial();
    const validatedData = partialSchema.parse(req.body);
    
    const supplier = await supplierManagementService.updateSupplier(id, validatedData);
    
    if (!supplier) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    broadcastSupplierUpdate(
      "supplier_updated",
      { supplier },
      {
        supplierId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );
    res.json(supplier);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Données invalides",
        details: error.errors 
      });
    }
    
    if (isUniqueViolation(error)) {
      return next(new AppError(409, "Un fournisseur porte déjà ce nom", { cause: error }));
    }

    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la mise à jour du fournisseur", { cause: error }), { event: "Erreur lors de la mise à jour du fournisseur" }));
  }
});

// PATCH /api/suppliers/:id/rating - Mettre à jour les évaluations d'un fournisseur (droits par métrique)
router.patch("/:id/rating", checkEvaluationPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const ratingSchema = z.object({
      qualityRating: z.number().min(0).max(5).optional(),
      reliabilityRating: z.number().min(0).max(5).optional(),
      priceCompetitiveness: z.number().min(0).max(5).optional(),
    });

    const ratings = ratingSchema.parse(req.body);
    const requestedFields = Object.keys(ratings) as RatingField[];

    if (requestedFields.length === 0) {
      return res.status(400).json({
        error: "Données invalides",
        message: "Au moins une note doit être fournie",
      });
    }

    const normalizedRole = normalizeRole(req.user?.role);
    const permissions = getRatingFieldPermissions(normalizedRole);
    const unauthorizedFields = requestedFields.filter((field) => !permissions[field]);

    if (unauthorizedFields.length > 0) {
      return res.status(403).json({
        error: "Accès refusé",
        message: `Votre rôle ne peut pas modifier: ${unauthorizedFields.join(", ")}`,
      });
    }

    const authorizedRatings: {
      qualityRating?: number;
      reliabilityRating?: number;
      priceCompetitiveness?: number;
    } = {};

    if (permissions.qualityRating && ratings.qualityRating !== undefined) {
      authorizedRatings.qualityRating = ratings.qualityRating;
    }
    if (permissions.reliabilityRating && ratings.reliabilityRating !== undefined) {
      authorizedRatings.reliabilityRating = ratings.reliabilityRating;
    }
    if (permissions.priceCompetitiveness && ratings.priceCompetitiveness !== undefined) {
      authorizedRatings.priceCompetitiveness = ratings.priceCompetitiveness;
    }

    const supplier = await supplierManagementService.updateSupplierRating(id, authorizedRatings);
    
    if (!supplier) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    broadcastSupplierUpdate(
      "supplier_rating_updated",
      {
        supplier,
        ratings: authorizedRatings,
      },
      {
        supplierId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );
    res.json(supplier);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Données invalides",
        details: error.errors 
      });
    }
    
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la mise à jour des évaluations", { cause: error }), { event: "Erreur lors de la mise à jour des évaluations" }));
  }
});

// POST /api/suppliers/:id/calculate-ratings - Calculer automatiquement les évaluations (admin uniquement)
router.post("/:id/calculate-ratings", checkEvaluationPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const normalizedRole = normalizeRole(req.user?.role);
    if (normalizedRole !== "admin") {
      return res.status(403).json({
        error: "Accès refusé",
        message: "Seul un administrateur peut lancer le calcul automatique des notes",
      });
    }

    const ratings = await supplierManagementService.calculateAutomaticRatings(id);
    
    if (!ratings) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    // Appliquer les évaluations calculées
    const updatedSupplier = await supplierManagementService.updateSupplierRating(id, ratings);

    broadcastSupplierUpdate(
      "supplier_rating_calculated",
      {
        supplier: updatedSupplier,
        ratings,
      },
      {
        supplierId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.json({
      ratings,
      supplier: updatedSupplier
    });
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors du calcul des évaluations", { cause: error }), { event: "Erreur lors du calcul des évaluations" }));
  }
});

// DELETE /api/suppliers/:id - Désactiver un fournisseur (soft delete) (admin, secretary et logistics)
router.delete("/:id", checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const success = await supplierManagementService.deactivateSupplier(id);
    
    if (!success) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    broadcastSupplierUpdate(
      "supplier_deactivated",
      {
        supplierId: id,
      },
      {
        supplierId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );
    res.json({ message: "Fournisseur désactivé avec succès" });
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la désactivation du fournisseur", { cause: error }), { event: "Erreur lors de la désactivation du fournisseur" }));
  }
});

// PATCH /api/suppliers/:id/reactivate - Réactiver un fournisseur (admin, secretary et logistics)
router.patch("/:id/reactivate", checkWritePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

    const success = await supplierManagementService.reactivateSupplier(id);
    
    if (!success) {
      return res.status(404).json({ error: "Fournisseur non trouvé" });
    }

    broadcastSupplierUpdate(
      "supplier_reactivated",
      {
        supplierId: id,
      },
      {
        supplierId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );
    res.json({ message: "Fournisseur réactivé avec succès" });
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la réactivation du fournisseur", { cause: error }), { event: "Erreur lors de la réactivation du fournisseur" }));
  }
});

export default router;
