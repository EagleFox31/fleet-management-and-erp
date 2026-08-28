import { Router, type Request, type Response, type NextFunction } from "express";
import { threeWayMatchingService } from "../services/three-way-matching-service";
import { insertSupplierInvoiceSchema } from "../../shared/schema";
import { z } from "zod";
import { storage } from "../storage";
import { supplierManagementService } from "../services/supplier-management-service";
import multer from "multer";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

const router = Router();

type InvoiceWorkflowScope = "parts" | "non_parts" | "none";
type UserRole = "admin" | "secretary" | "warehouse" | "logistics" | "workshop_manager" | "technician" | string;

const INVOICE_READ_ROLES: readonly UserRole[] = ["admin", "secretary", "warehouse", "logistics", "workshop_manager"];
const INVOICE_CREATE_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_APPROVAL_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_PAYMENT_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_AUTO_APPROVE_ROLES: readonly UserRole[] = ["admin"];

type SupplierInvoiceRealtimeEvent =
  | "supplier_invoice_created"
  | "supplier_invoice_updated"
  | "supplier_invoice_settlement_recorded"
  | "supplier_invoice_settlement_reconciled"
  | "supplier_invoice_bulk_approved";

function broadcastSupplierInvoiceUpdate(
  eventType: SupplierInvoiceRealtimeEvent,
  data: {
    invoiceId?: number | null;
    purchaseOrderId?: number | null;
    invoice?: unknown;
    settlement?: unknown;
    approvedInvoices?: number[];
    action?: string;
    triggeredBy?: number | null;
  },
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  const invoiceId = typeof data.invoiceId === "number" ? data.invoiceId : null;
  const purchaseOrderId =
    typeof data.purchaseOrderId === "number" ? data.purchaseOrderId : null;

  broadcastUpdate(eventType, {
    entity: "supplier_invoice",
    entityId: invoiceId,
    payload: {
      invoiceId,
      purchaseOrderId,
      invoice: data.invoice,
      settlement: data.settlement,
      approvedInvoices: data.approvedInvoices,
      action: data.action,
      triggeredBy: data.triggeredBy ?? null,
    },
    scope: { type: "broadcast" },
  });
}

const hasAnyRole = (role: string | undefined, allowed: readonly UserRole[]) => {
  if (!role) return false;
  return allowed.includes(role as UserRole);
};

const checkRolePermission = (
  req: Request,
  res: Response,
  allowedRoles: readonly UserRole[],
  message: string
): boolean => {
  if (!req.user || !hasAnyRole(req.user.role, allowedRoles)) {
    res.status(403).json({
      error: "Accès refusé",
      message,
    });
    return false;
  }

  return true;
};

const getValidationRolesByScope = (scope: InvoiceWorkflowScope): readonly UserRole[] => {
  if (scope === "parts") return ["admin", "warehouse", "workshop_manager"];
  if (scope === "non_parts") return ["admin", "secretary", "logistics"];
  return ["admin", "secretary"];
};

/**
 * Middleware pour vérifier l'authentification
 */
const checkAuth = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    next();
  } catch (error) {
    console.error('Error in checkAuth middleware:', error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

/**
 * Vérifier si l'utilisateur peut consulter les factures
 */
const checkReadPermission = async (req: Request, res: Response, next: NextFunction) => {
  await checkAuth(req, res, () => {});
  if (!req.user) return;

  if (!checkRolePermission(
    req,
    res,
    INVOICE_READ_ROLES,
    "Accès facture réservé à l'administration, secrétariat, magasin, achats et atelier"
  )) {
    return;
  }

  next();
};

/**
 * Vérifier si l'utilisateur peut créer/importer des factures
 */
const checkCreatePermission = async (req: Request, res: Response, next: NextFunction) => {
  await checkAuth(req, res, () => {});
  if (!req.user) return;

  if (!checkRolePermission(
    req,
    res,
    INVOICE_CREATE_ROLES,
    "Seuls l'administrateur et la secrétaire peuvent créer/importer des factures"
  )) {
    return;
  }

  next();
};

/**
 * Vérifier si l'utilisateur peut approuver une facture
 */
const checkApprovalPermission = async (req: Request, res: Response, next: NextFunction) => {
  await checkAuth(req, res, () => {});
  if (!req.user) return;

  if (!checkRolePermission(
    req,
    res,
    INVOICE_APPROVAL_ROLES,
    "Seuls l'administrateur et la secrétaire peuvent approuver des factures"
  )) {
    return;
  }

  next();
};

/**
 * Vérifier si l'utilisateur peut enregistrer un paiement
 */
const checkPaymentPermission = async (req: Request, res: Response, next: NextFunction) => {
  await checkAuth(req, res, () => {});
  if (!req.user) return;

  if (!checkRolePermission(
    req,
    res,
    INVOICE_PAYMENT_ROLES,
    "Seuls l'administrateur et la secrétaire peuvent enregistrer un paiement fournisseur"
  )) {
    return;
  }

  next();
};

/**
 * Endpoint réservé à l'automatisation (supervision admin)
 */
const checkAutoApprovePermission = async (req: Request, res: Response, next: NextFunction) => {
  await checkAuth(req, res, () => {});
  if (!req.user) return;

  if (!checkRolePermission(
    req,
    res,
    INVOICE_AUTO_APPROVE_ROLES,
    "Action réservée au moteur d'automatisation (profil admin)"
  )) {
    return;
  }

  next();
};

const settlementProofUploadDir = path.join(
  process.cwd(),
  "uploads",
  "supplier-invoices",
  "settlements"
);

if (!fs.existsSync(settlementProofUploadDir)) {
  fs.mkdirSync(settlementProofUploadDir, { recursive: true });
}

const uploadSettlementProof = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, settlementProofUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const baseName = (file.originalname || "proof")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.[^.]+$/, "")
        .slice(0, 40);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${baseName || "proof"}-${uniqueSuffix}${extension || ".bin"}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Justificatif invalide. Formats acceptés: PDF, JPG, PNG, WEBP."));
  },
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
}).single("proofFile");

/**
 * GET /api/supplier-invoices
 * Liste des factures fournisseurs avec filtres
 */
router.get("/", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const { status, supplierId, hasDiscrepancy, startDate, endDate } = req.query;

    const filters = {
      status: status as string | undefined,
      supplierId: supplierId ? parseInt(supplierId as string) : undefined,
      hasDiscrepancy: hasDiscrepancy === 'true' ? true : hasDiscrepancy === 'false' ? false : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    };

    const invoices = await threeWayMatchingService.getSupplierInvoices(filters);
    
    res.json(invoices);
  } catch (error) {
    console.error("Erreur lors de la récupération des factures:", error);
    res.status(500).json({ 
      error: "Erreur lors de la récupération des factures",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * POST /api/supplier-invoices
 * Créer une nouvelle facture fournisseur avec contrôle 3 voies automatique
 */
router.post("/", checkCreatePermission, async (req: Request, res: Response) => {
  try {
    const validatedData = insertSupplierInvoiceSchema.parse(req.body);
    
    const result = await threeWayMatchingService.createSupplierInvoice(
      validatedData,
      req.user?.id
    );

    broadcastSupplierInvoiceUpdate("supplier_invoice_created", {
      invoiceId: result.invoice.id,
      purchaseOrderId: result.invoice.purchaseOrderId ?? null,
      invoice: result.invoice,
      action: "created",
      triggeredBy: req.user?.id ?? null,
    });

    res.status(201).json({
      invoice: result.invoice,
      validation: result.validation,
      message: result.validation?.hasDiscrepancy 
        ? `Facture créée avec écart de ${result.validation.variancePercentage}%` 
        : "Facture créée avec succès"
    });
  } catch (error) {
    console.error("Erreur lors de la création de la facture:", error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Données invalides", 
        details: error.errors 
      });
    }

    res.status(500).json({ 
      error: "Erreur lors de la création de la facture",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * GET /api/supplier-invoices/discrepancies
 * Récupérer les factures avec écarts à traiter (dashboard)
 */
router.get("/discrepancies", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const result = await threeWayMatchingService.escalateDiscrepancies();
    res.json(result);
  } catch (error) {
    console.error("Erreur lors de la récupération des écarts:", error);
    res.status(500).json({ 
      error: "Erreur lors de la récupération des écarts",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * GET /api/supplier-invoices/overdue
 * Récupérer les factures en retard (dueDate dépassée et non payées)
 */
router.get("/overdue", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const overdueInvoices = await threeWayMatchingService.getOverdueInvoices();
    res.json(overdueInvoices);
  } catch (error) {
    console.error("Erreur lors de la récupération des factures en retard:", error);
    res.status(500).json({ 
      error: "Erreur lors de la récupération des factures en retard",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * POST /api/supplier-invoices/auto-approve
 * Approuver automatiquement les factures sans écart
 */
router.post("/auto-approve", checkAutoApprovePermission, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const result = await threeWayMatchingService.autoApproveMatches(req.user.id);

    if (result.approvedInvoices.length > 0) {
      broadcastSupplierInvoiceUpdate("supplier_invoice_bulk_approved", {
        approvedInvoices: result.approvedInvoices,
        action: "auto_approved",
        triggeredBy: req.user.id,
      });
    }
    
    res.json({
      ...result,
      message: `${result.approvedCount} facture(s) approuvée(s) automatiquement`
    });
  } catch (error) {
    console.error("Erreur lors de l'approbation automatique:", error);
    res.status(500).json({ 
      error: "Erreur lors de l'approbation automatique",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * GET /api/supplier-invoices/statistics
 * Statistiques globales des factures fournisseurs
 */
router.get("/statistics", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const stats = await threeWayMatchingService.getStatistics();
    res.json(stats);
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques:", error);
    res.status(500).json({ 
      error: "Erreur lors de la récupération des statistiques",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * GET /api/supplier-invoices/:id
 * Détails d'une facture avec contrôle 3 voies
 */
router.get("/:id", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.id);
    const invoiceData = await threeWayMatchingService.getSupplierInvoiceById(invoiceId);

    if (!invoiceData) {
      return res.status(404).json({ error: "Facture non trouvée" });
    }

    // Mapper threeWayMatch → validation pour cohérence frontend
    const { threeWayMatch, ...invoice } = invoiceData;
    
    // Formater validation pour correspondre à l'interface frontend SupplierInvoiceDetails
    let validation: any = null;
    if (threeWayMatch) {
      const normalizedDetails =
        typeof threeWayMatch.details === "string"
          ? (() => {
              try {
                return JSON.parse(threeWayMatch.details);
              } catch {
                return threeWayMatch.details;
              }
            })()
          : threeWayMatch.details;

      validation = {
        hasDiscrepancy: threeWayMatch.hasDiscrepancy,
        variancePercentage: threeWayMatch.variancePercentage,
        varianceAmount: threeWayMatch.priceVariance, // Mapper priceVariance → varianceAmount
        details: normalizedDetails,
      };
    }
    
    const response = {
      invoice,
      supplier: invoiceData.supplier,
      purchaseOrder: invoiceData.purchaseOrder,
      validatedByUser: invoiceData.validatedByUser,
      approvedByUser: invoiceData.approvedByUser,
      paidByUser: invoiceData.paidByUser,
      validation,
    };

    res.json(response);
  } catch (error) {
    console.error("Erreur lors de la récupération de la facture:", error);
    res.status(500).json({ 
      error: "Erreur lors de la récupération de la facture",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * PATCH /api/supplier-invoices/:id/validate
 * Valider une facture (étape 1 du workflow)
 */
router.patch("/:id/validate", checkAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseInt(req.params.id);
    const { notes } = req.body;

    const invoiceData = await threeWayMatchingService.getSupplierInvoiceById(invoiceId);
    if (!invoiceData) {
      return res.status(404).json({ error: "Facture non trouvée" });
    }

    const scope = (invoiceData.workflowScope || "none") as InvoiceWorkflowScope;
    const allowedRoles = getValidationRolesByScope(scope);
    const scopeLabel = scope === "parts"
      ? "factures liées aux pièces atelier"
      : scope === "non_parts"
        ? "factures d'achats hors atelier"
        : "factures administratives sans bon de commande";

    if (!checkRolePermission(
      req,
      res,
      allowedRoles,
      `Validation refusée: ce profil ne peut pas valider les ${scopeLabel}`
    )) {
      return;
    }

    const updated = await threeWayMatchingService.validateInvoice(
      invoiceId,
      req.user.id,
      notes
    );

    broadcastSupplierInvoiceUpdate("supplier_invoice_updated", {
      invoiceId: updated.id,
      purchaseOrderId: updated.purchaseOrderId ?? null,
      invoice: updated,
      action: "validated",
      triggeredBy: req.user.id,
    });

    res.json({
      invoice: updated,
      message: "Facture validée avec succès"
    });
  } catch (error) {
    console.error("Erreur lors de la validation de la facture:", error);
    res.status(500).json({ 
      error: "Erreur lors de la validation de la facture",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * PATCH /api/supplier-invoices/:id/approve
 * Approuver une facture (étape 2 du workflow)
 */
router.patch("/:id/approve", checkApprovalPermission, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseInt(req.params.id);

    const updated = await threeWayMatchingService.approveInvoice(
      invoiceId,
      req.user.id
    );

    broadcastSupplierInvoiceUpdate("supplier_invoice_updated", {
      invoiceId: updated.id,
      purchaseOrderId: updated.purchaseOrderId ?? null,
      invoice: updated,
      action: "approved",
      triggeredBy: req.user.id,
    });

    res.json({
      invoice: updated,
      message: "Facture approuvée avec succès"
    });
  } catch (error) {
    console.error("Erreur lors de l'approbation de la facture:", error);
    res.status(500).json({ 
      error: "Erreur lors de l'approbation de la facture",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * GET /api/supplier-invoices/:id/settlements
 * Historique des règlements saisis / rapprochés pour une facture
 */
router.get("/:id/settlements", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.id);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: "ID facture invalide" });
    }

    const settlements = await threeWayMatchingService.getInvoiceSettlements(invoiceId);
    res.json(settlements);
  } catch (error) {
    console.error("Erreur lors de la récupération des règlements:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération des règlements",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
});

/**
 * GET /api/supplier-invoices/:id/settlements/:settlementId/proof
 * Ouvrir le justificatif uploadé d'un règlement
 */
router.get("/:id/settlements/:settlementId/proof", checkReadPermission, async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.id);
    const settlementId = parseInt(req.params.settlementId);
    if (Number.isNaN(invoiceId) || Number.isNaN(settlementId)) {
      return res.status(400).json({ error: "ID invalide" });
    }

    const settlements = await threeWayMatchingService.getInvoiceSettlements(invoiceId);
    const settlement = settlements.find((item) => item.id === settlementId);
    if (!settlement || !settlement.proofReference) {
      return res.status(404).json({ error: "Justificatif introuvable" });
    }

    const relativeProofPath = String(settlement.proofReference).replace(/^\/+/, "");
    const absoluteProofPath = path.resolve(process.cwd(), relativeProofPath);
    const uploadsRoot = path.resolve(process.cwd(), "uploads");
    if (!absoluteProofPath.startsWith(uploadsRoot)) {
      return res.status(400).json({ error: "Chemin de justificatif invalide" });
    }

    if (!fs.existsSync(absoluteProofPath)) {
      return res.status(404).json({ error: "Fichier justificatif non trouvé" });
    }

    return res.sendFile(absoluteProofPath);
  } catch (error) {
    console.error("Erreur lors de la lecture du justificatif:", error);
    return res.status(500).json({
      error: "Erreur lors de la lecture du justificatif",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
});

/**
 * POST /api/supplier-invoices/:id/settlements
 * Enregistrer un règlement (saisie comptable, sans rapprochement bancaire automatique)
 */
router.post("/:id/settlements", checkPaymentPermission, (req: Request, res: Response) => {
  uploadSettlementProof(req, res, async (err) => {
    try {
      if (err) {
        return res.status(400).json({
          error: "Upload justificatif invalide",
          details: err.message,
        });
      }

      if (!req.user) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      const invoiceId = parseInt(req.params.id);
      if (Number.isNaN(invoiceId)) {
        return res.status(400).json({ error: "ID facture invalide" });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Justificatif requis",
          details: "Le justificatif (image/PDF) est obligatoire pour enregistrer un règlement.",
        });
      }

      const readField = (value: unknown): string | undefined => {
        if (Array.isArray(value)) return readField(value[0]);
        if (typeof value === "string") return value.trim();
        if (typeof value === "number") return String(value);
        return undefined;
      };

      const rawAmount = readField(req.body?.amount);
      const normalizedAmount = rawAmount
        ? rawAmount.replace(/\s+/g, "").replace(",", ".")
        : undefined;

      const normalizedPayload = {
        amount: normalizedAmount,
        paymentMethod: readField(req.body?.paymentMethod),
        paymentReference: readField(req.body?.paymentReference),
        paymentDate: readField(req.body?.paymentDate),
        valueDate: readField(req.body?.valueDate),
        treasuryAccount: readField(req.body?.treasuryAccount),
        notes: readField(req.body?.notes),
      };

      const payload = z.object({
        amount: z.coerce.number().positive(),
        paymentMethod: z.enum(["virement", "cheque", "especes", "mobile", "autre"]),
        paymentReference: z.string().trim().min(1),
        paymentDate: z.string().trim().min(1),
        valueDate: z.string().trim().optional(),
        treasuryAccount: z.string().trim().optional(),
        notes: z.string().trim().optional(),
      }).parse(normalizedPayload);

      const proofReference = `/uploads/supplier-invoices/settlements/${req.file.filename}`;

      const { settlement, invoice } = await threeWayMatchingService.recordInvoiceSettlement(
        invoiceId,
        req.user.id,
        {
          amount: payload.amount,
          paymentMethod: payload.paymentMethod,
          paymentReference: payload.paymentReference,
          paymentDate: payload.paymentDate,
          valueDate: payload.valueDate || undefined,
          treasuryAccount: payload.treasuryAccount || undefined,
          proofReference,
          notes: payload.notes || undefined,
        }
      );

      broadcastSupplierInvoiceUpdate("supplier_invoice_settlement_recorded", {
        invoiceId: invoice.id,
        purchaseOrderId: invoice.purchaseOrderId ?? null,
        invoice,
        settlement,
        action: "settlement_recorded",
        triggeredBy: req.user.id,
      });

      return res.status(201).json({
        invoice,
        settlement,
        message: "Règlement saisi. En attente de rapprochement bancaire.",
      });
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error("Erreur suppression justificatif après échec:", unlinkError);
        }
      }

      console.error("Erreur lors de l'enregistrement du règlement:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Données invalides",
          details: error.errors,
        });
      }

      return res.status(500).json({
        error: "Erreur lors de l'enregistrement du règlement",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  });
});

/**
 * PATCH /api/supplier-invoices/:id/settlements/:settlementId/reconcile
 * Rapprocher un règlement saisi avec la preuve bancaire
 */
router.patch("/:id/settlements/:settlementId/reconcile", checkPaymentPermission, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseInt(req.params.id);
    const settlementId = parseInt(req.params.settlementId);
    if (Number.isNaN(invoiceId) || Number.isNaN(settlementId)) {
      return res.status(400).json({ error: "ID invalide" });
    }

    const reconciliationNote = typeof req.body?.reconciliationNote === "string"
      ? req.body.reconciliationNote
      : undefined;

    const result = await threeWayMatchingService.reconcileInvoiceSettlement(
      invoiceId,
      settlementId,
      req.user.id,
      reconciliationNote
    );

    broadcastSupplierInvoiceUpdate("supplier_invoice_settlement_reconciled", {
      invoiceId: result.invoice.id,
      purchaseOrderId: result.invoice.purchaseOrderId ?? null,
      invoice: result.invoice,
      settlement: result.settlement,
      action: "settlement_reconciled",
      triggeredBy: req.user.id,
    });

    res.json({
      settlement: result.settlement,
      invoice: result.invoice,
      message: "Règlement rapproché avec succès",
    });
  } catch (error) {
    console.error("Erreur lors du rapprochement du règlement:", error);
    res.status(500).json({
      error: "Erreur lors du rapprochement du règlement",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
});

/**
 * POST /api/supplier-invoices/:id/payment
 * Enregistrer le règlement d'une facture (endpoint legacy compat)
 */
router.post("/:id/payment", checkPaymentPermission, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseInt(req.params.id);
    const { paymentDate, paymentMethod, proofReference } = req.body;

    if (!paymentDate || !paymentMethod || !proofReference) {
      return res.status(400).json({ 
        error: "Date, méthode et justificatif requis" 
      });
    }

    const updated = await threeWayMatchingService.markInvoiceAsPaid(
      invoiceId,
      req.user.id,
      paymentDate,
      paymentMethod,
      proofReference
    );

    broadcastSupplierInvoiceUpdate("supplier_invoice_updated", {
      invoiceId: updated.id,
      purchaseOrderId: updated.purchaseOrderId ?? null,
      invoice: updated,
      action: "paid_legacy",
      triggeredBy: req.user.id,
    });

    res.json({
      invoice: updated,
      message: "Règlement enregistré avec succès"
    });
  } catch (error) {
    console.error("Erreur lors de l'enregistrement du règlement:", error);
    res.status(500).json({ 
      error: "Erreur lors de l'enregistrement du règlement",
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * Configuration multer pour l'upload Excel
 */
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream' // Certains navigateurs/clients envoient ce MIME type
    ];
    
    const isValidExtension = file.originalname.toLowerCase().endsWith('.xlsx');
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
    
    if (isValidMimeType && isValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers Excel (.xlsx) sont acceptés'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  }
}).single('file');

/**
 * POST /api/supplier-invoices/import
 * Importer des factures depuis un fichier Excel
 */
router.post("/import", checkCreatePermission, (req: Request, res: Response) => {
  uploadExcel(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ 
        error: "Erreur lors de l'upload du fichier",
        message: err.message 
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    try {
      // Parser le fichier Excel
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

      const results = {
        success: 0,
        failed: 0,
        total: data.length,
        errors: [] as Array<{ row: number; message: string }>
      };

      // Récupérer les fournisseurs et factures existantes UNE SEULE FOIS (optimisation)
      const suppliers = await supplierManagementService.getSuppliers();
      const supplierMap = new Map<string, (typeof suppliers)[number]>(
        suppliers.map(s => [s.name.toLowerCase().trim(), s])
      );
      
      const existingInvoices = await threeWayMatchingService.getSupplierInvoices({});
      const existingInvoiceNumbers = new Set(
        existingInvoices.map(inv => inv.invoiceNumber.toLowerCase().trim())
      );

      // Fonction pour parser les dates - gère à la fois strings et dates Excel
      const parseDate = (dateValue: unknown): string => {
        // Si c'est un nombre (date Excel en format serial)
        if (typeof dateValue === 'number') {
          const excelDate = XLSX.SSF.parse_date_code(dateValue);
          const year = excelDate.y;
          const month = String(excelDate.m).padStart(2, '0');
          const day = String(excelDate.d).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
        
        // Si c'est déjà un objet Date
        if (dateValue instanceof Date) {
          const year = dateValue.getFullYear();
          const month = String(dateValue.getMonth() + 1).padStart(2, '0');
          const day = String(dateValue.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
        
        // Si c'est une string au format JJ/MM/AAAA
        const dateStr = String(dateValue ?? "").trim();
        const parts = dateStr.split('/');
        if (parts.length !== 3) {
          throw new Error(`Format de date invalide: ${dateStr}. Attendu: JJ/MM/AAAA`);
        }
        const [day, month, year] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      };

      // Fonction pour valider et parser un nombre
      const parseNumber = (value: unknown, fieldName: string): number => {
        const num = typeof value === 'number'
          ? value
          : Number.parseFloat(String(value ?? "").replace(/\s/g, ''));
        if (isNaN(num) || num < 0) {
          throw new Error(`${fieldName} invalide: ${value}`);
        }
        return num;
      };

      // Traiter chaque ligne
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNumber = i + 2; // +2 car la ligne 1 est l'en-tête et on commence à 0

        try {
          // Validation des champs obligatoires
          if (!row['Numéro Facture']) {
            throw new Error("Numéro de facture manquant");
          }
          if (!row['Fournisseur']) {
            throw new Error("Fournisseur manquant");
          }
          if (!row['Date Facture']) {
            throw new Error("Date de facture manquante");
          }
          if (!row['Date Échéance']) {
            throw new Error("Date d'échéance manquante");
          }
          if (!row['Montant HT']) {
            throw new Error("Montant HT manquant");
          }
          if (!row['Montant TTC']) {
            throw new Error("Montant TTC manquant");
          }

          const invoiceNumber = String(row['Numéro Facture']).trim();
          
          // Vérifier les doublons
          if (existingInvoiceNumbers.has(invoiceNumber.toLowerCase())) {
            throw new Error(`Facture "${invoiceNumber}" existe déjà dans le système`);
          }

          // Chercher le fournisseur dans le map (optimisé)
          const supplierName = String(row['Fournisseur']).toLowerCase().trim();
          const supplier = supplierMap.get(supplierName);

          if (!supplier) {
            throw new Error(`Fournisseur "${String(row['Fournisseur'])}" non trouvé dans le système`);
          }

          // Parser les dates
          const invoiceDate = parseDate(row['Date Facture']);
          const dueDate = parseDate(row['Date Échéance']);

          // Parser et valider les montants
          const totalHT = parseNumber(row['Montant HT'], 'Montant HT');
          const totalTTC = parseNumber(row['Montant TTC'], 'Montant TTC');
          
          // Validation cohérence: TTC doit être >= HT
          if (totalTTC < totalHT) {
            throw new Error(`Montant TTC (${totalTTC}) ne peut pas être inférieur au montant HT (${totalHT})`);
          }

          const vatAmount = totalTTC - totalHT;

          // Valider le taux de TVA si fourni
          if (row['TVA (%)']) {
            const expectedVatRate = parseNumber(row['TVA (%)'], 'TVA (%)');
            const calculatedVatRate = totalHT > 0 ? (vatAmount / totalHT) * 100 : 0;
            const variance = Math.abs(calculatedVatRate - expectedVatRate);
            
            if (variance > 0.5) { // Tolérance de 0.5%
              throw new Error(
                `Incohérence TVA: taux indiqué ${expectedVatRate.toFixed(2)}% mais calculé ${calculatedVatRate.toFixed(2)}%`
              );
            }
          }

          // Créer la facture avec validation Zod
          const invoiceData = insertSupplierInvoiceSchema.parse({
            invoiceNumber,
            supplierId: supplier.id,
            invoiceDate,
            dueDate,
            totalAmountHT: totalHT.toFixed(2),
            totalAmountTTC: totalTTC.toFixed(2),
            vatAmount: vatAmount.toFixed(2),
            purchaseOrderNumber: row['N° Commande'] ? String(row['N° Commande']).trim() : undefined,
            status: 'received',
            hasDiscrepancy: false,
            createdBy: req.user!.id
          });

          // Créer la facture via le service (déclenche le three-way matching)
          await threeWayMatchingService.createSupplierInvoice(invoiceData, req.user!.id);
          
          // Ajouter au set pour détecter les doublons dans le fichier lui-même
          existingInvoiceNumbers.add(invoiceNumber.toLowerCase());
          
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            message: error instanceof Error ? error.message : 'Erreur inconnue'
          });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Erreur lors de l'import Excel:", error);
      res.status(500).json({ 
        error: "Erreur lors de l'import",
        message: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  });
});

export default router;
