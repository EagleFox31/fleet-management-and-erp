import { Router, type Request, type Response, type NextFunction } from "express";
import { threeWayMatchingService } from "../services/three-way-matching-service";
import { insertSupplierInvoiceSchema, purchaseOrders } from "../../shared/schema";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { storage } from "../storage";
import { supplierManagementService } from "../services/supplier-management-service";
import { PROCUREMENT_ROLES } from "@shared/constants/roles";
import multer from "multer";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { moduleLogger } from "../lib/logger";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { MAX_DB_INTEGER_ID } from "@shared/contracts/common";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { supplierAnnualRecapQuerySchema } from "@shared/contracts/supplier-annual-recap";
import { supplierAnnualRecap } from "../services/supplier-annual-recap-service";
import {
  SETTLEMENT_PROOF_EXTENSION_BY_MIME,
  SETTLEMENT_PROOF_PREFIX,
  settlementProofContentType,
  settlementProofFileName,
  settlementProofPath,
} from "../lib/settlement-proof";
import { contentDisposition } from "../lib/content-disposition";
import { canonicalWorkbookArchive } from "../lib/xlsx-import-guard";
import { compactImportSheet, importTooLongError, isBlankCell } from "../lib/supplier-invoice-import-sheet";
import {
  SUPPLIER_INVOICE_IMPORT_COLUMNS,
  SUPPLIER_INVOICE_IMPORT_MAX_FILE_BYTES,
  SUPPLIER_INVOICE_IMPORT_MAX_ROWS,
  SUPPLIER_INVOICE_IMPORT_MAX_UNCOMPRESSED_BYTES,
} from "../../shared/contracts/supplier-invoice-import";

const router = Router();
const log = moduleLogger("supplier-invoices");

type InvoiceWorkflowScope = "parts" | "non_parts" | "none";
type UserRole = "admin" | "secretary" | "warehouse" | "logistics" | "workshop_manager" | "technician" | string;

// Aligné sur la garde de montage (PROCUREMENT_ROLES) : le chef d'atelier ne voit pas les factures fournisseur.
const INVOICE_READ_ROLES: readonly UserRole[] = PROCUREMENT_ROLES;
const INVOICE_CREATE_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_APPROVAL_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_PAYMENT_ROLES: readonly UserRole[] = ["admin", "secretary"];
const INVOICE_AUTO_APPROVE_ROLES: readonly UserRole[] = ["admin"];

type SupplierInvoiceRealtimeEvent =
  | "supplier_invoice_created"
  | "supplier_invoice_updated"
  | "supplier_invoice_settlement_recorded"
  | "supplier_invoice_settlement_reconciled"
  | "supplier_invoice_settlement_rejected"
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
    scope: { type: "roles", roles: [...INVOICE_READ_ROLES] },
  });
  // La direction ne lit pas la facture : trame réduite aux identifiants, qui suffit à rafraîchir son tableau de bord.
  broadcastUpdate(eventType, {
    entity: "supplier_invoice",
    entityId: invoiceId,
    payload: { invoiceId, purchaseOrderId },
    scope: { type: "roles", roles: ["management"] },
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
  // Pas de chef d'atelier : la garde de montage (PROCUREMENT_ROLES) le refuse avant.
  if (scope === "parts") return ["admin", "warehouse"];
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
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Échec du chargement de l'utilisateur (checkAuth)" }));
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
    "Accès facture réservé à l'administration, au secrétariat, au magasin et à la logistique"
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
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, settlementProofFileName(file.originalname, uniqueSuffix, file.mimetype));
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (Object.hasOwn(SETTLEMENT_PROOF_EXTENSION_BY_MIME, file.mimetype)) {
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
router.get("/", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, supplierId, hasDiscrepancy, startDate, endDate } = req.query;

    const filters = {
      status: status as string | undefined,
      supplierId: parseQueryId(supplierId, "ID fournisseur invalide"),
      hasDiscrepancy: hasDiscrepancy === 'true' ? true : hasDiscrepancy === 'false' ? false : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    };

    const invoices = await threeWayMatchingService.getSupplierInvoices(filters);
    
    res.json(invoices);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des factures.", { cause: error }), { event: "Erreur lors de la récupération des factures" }));
  }
});

/**
 * POST /api/supplier-invoices
 * Créer une nouvelle facture fournisseur avec contrôle 3 voies automatique
 */
// Champs tenus par le workflow : retirés de la saisie (ignorés, pas refusés).
const createSupplierInvoiceSchema = insertSupplierInvoiceSchema.omit({
  status: true,
  validatedBy: true,
  validatedAt: true,
  approvedBy: true,
  approvedAt: true,
  paidBy: true,
  paidDate: true,
  paymentDate: true,
  isPaymentComplete: true,
  balance: true,
  priceVariance: true,
  quantityVariance: true,
  variancePercentage: true,
  hasDiscrepancy: true,
});

router.post("/", checkCreatePermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = createSupplierInvoiceSchema.parse(req.body);
    
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
    // Le gestionnaire central journalise : ZodError -> 400 par champ,
    // AppError -> son statut, le reste -> 500 générique avec référence.
    next(error);
  }
});

/**
 * GET /api/supplier-invoices/discrepancies
 * Récupérer les factures avec écarts à traiter (dashboard)
 */
router.get("/discrepancies", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await threeWayMatchingService.escalateDiscrepancies();
    res.json(result);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des écarts.", { cause: error }), { event: "Erreur lors de la récupération des écarts" }));
  }
});

/**
 * GET /api/supplier-invoices/overdue
 * Récupérer les factures en retard (dueDate dépassée et non payées)
 */
router.get("/overdue", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const overdueInvoices = await threeWayMatchingService.getOverdueInvoices();
    res.json(overdueInvoices);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des factures en retard.", { cause: error }), { event: "Erreur lors de la récupération des factures en retard" }));
  }
});

/**
 * POST /api/supplier-invoices/auto-approve
 * Approuver automatiquement les factures sans écart
 */
router.post("/auto-approve", checkAutoApprovePermission, async (req: Request, res: Response, next: NextFunction) => {
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
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de l'approbation automatique.", { cause: error }), { event: "Erreur lors de l'approbation automatique" }));
  }
});

/**
 * GET /api/supplier-invoices/statistics
 * Statistiques globales des factures fournisseurs
 */
router.get("/statistics", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await threeWayMatchingService.getStatistics();
    res.json(stats);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des statistiques.", { cause: error }), { event: "Erreur lors de la récupération des statistiques" }));
  }
});

/**
 * GET /api/supplier-invoices/annual-recap?year=AAAA[&supplierId=N]
 * HT, TVA, TTC et reste dû actuel par fournisseur et par mois. Déclarée avant `/:id`.
 */
router.get("/annual-recap", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = supplierAnnualRecapQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Paramètre inconnu, valeur répétée ou tableau : le message de zod est technique.
      const issue = parsed.error.issues[0];
      if (issue?.code === "unrecognized_keys") throw new AppError(400, "Paramètre non reconnu.");
      if (issue?.code === "invalid_type") {
        throw new AppError(400, issue.path[0] === "supplierId" ? "Identifiant de fournisseur invalide." : "Année invalide.");
      }
      throw new AppError(400, issue?.message ?? "Année invalide.");
    }
    const year = Number(parsed.data.year ?? isoDateInZone(new Date()).slice(0, 4));
    const supplierId = parseQueryId(parsed.data.supplierId, "Identifiant de fournisseur invalide.") ?? null;
    res.json(await supplierAnnualRecap(year, supplierId));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/supplier-invoices/:id
 * Détails d'une facture avec contrôle 3 voies
 */
router.get("/:id", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = parseRouteId(req.params.id, "Identifiant de facture invalide.");
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
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération de la facture.", { cause: error }), { event: "Erreur lors de la récupération de la facture" }));
  }
});

/**
 * PATCH /api/supplier-invoices/:id/validate
 * Valider une facture (étape 1 du workflow)
 */
router.patch("/:id/validate", checkAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseRouteId(req.params.id, "Identifiant de facture invalide.");
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

    const { invoice: updated, replayed } = await threeWayMatchingService.validateInvoice(
      invoiceId,
      req.user.id,
      notes
    );

    // Rejeu sans écriture : rien n'a changé, rien à diffuser.
    if (!replayed) {
      broadcastSupplierInvoiceUpdate("supplier_invoice_updated", {
        invoiceId: updated.id,
        purchaseOrderId: updated.purchaseOrderId ?? null,
        invoice: updated,
        action: "validated",
        triggeredBy: req.user.id,
      });
    }

    res.json({
      invoice: updated,
      message: "Facture validée avec succès"
    });
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la validation de la facture.", { cause: error }), { event: "Erreur lors de la validation de la facture" }));
  }
});

/**
 * PATCH /api/supplier-invoices/:id/approve
 * Approuver une facture (étape 2 du workflow)
 */
router.patch("/:id/approve", checkApprovalPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseRouteId(req.params.id, "Identifiant de facture invalide.");

    const { invoice: updated, replayed } = await threeWayMatchingService.approveInvoice(
      invoiceId,
      req.user.id
    );

    // Rejeu sans écriture : rien n'a changé, rien à diffuser.
    if (!replayed) {
      broadcastSupplierInvoiceUpdate("supplier_invoice_updated", {
        invoiceId: updated.id,
        purchaseOrderId: updated.purchaseOrderId ?? null,
        invoice: updated,
        action: "approved",
        triggeredBy: req.user.id,
      });
    }

    res.json({
      invoice: updated,
      message: "Facture approuvée avec succès"
    });
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de l'approbation de la facture.", { cause: error }), { event: "Erreur lors de l'approbation de la facture" }));
  }
});

/**
 * GET /api/supplier-invoices/:id/settlements
 * Historique des règlements saisis / rapprochés pour une facture
 */
router.get("/:id/settlements", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = parseRouteId(req.params.id, "ID facture invalide");

    const settlements = await threeWayMatchingService.getInvoiceSettlements(invoiceId);
    res.json(settlements);
  } catch (error) {
    next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la récupération des règlements.", { cause: error }), { event: "Erreur lors de la récupération des règlements" }));
  }
});

/**
 * GET /api/supplier-invoices/:id/settlements/:settlementId/proof
 * Ouvrir le justificatif uploadé d'un règlement
 */
router.get("/:id/settlements/:settlementId/proof", checkReadPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = parseRouteId(req.params.id, "Identifiant de facture ou de règlement invalide.");
    const settlementId = parseRouteId(req.params.settlementId, "Identifiant de facture ou de règlement invalide.");

    const settlements = await threeWayMatchingService.getInvoiceSettlements(invoiceId);
    const settlement = settlements.find((item) => item.id === settlementId);
    // Servi seulement depuis le dossier des justificatifs, y compris pour une ligne ancienne.
    const proofPath = settlementProofPath(settlement?.proofReference);
    if (!proofPath || !fs.existsSync(proofPath)) {
      throw new AppError(404, "Justificatif introuvable");
    }

    // Toujours en téléchargement, type tiré de l'extension en liste blanche : une ligne ancienne en .html
    // ou .svg n'est pas rendue par le navigateur sur l'origine de l'application.
    res.setHeader("X-Content-Type-Options", "nosniff");
    const headers = {
      "Content-Type": settlementProofContentType(proofPath),
      "Content-Disposition": contentDisposition("attachment", path.basename(proofPath)),
    };
    return res.sendFile(proofPath, { headers }, (err) => {
      if (err && !res.headersSent) next(new AppError(404, "Justificatif introuvable", { cause: err }));
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/supplier-invoices/:id/settlements
 * Enregistrer un règlement (saisie comptable, sans rapprochement bancaire automatique)
 */
router.post("/:id/settlements", checkPaymentPermission, (req: Request, res: Response, next: NextFunction) => {
  uploadSettlementProof(req, res, async (err) => {
    // Le justificatif n'est gardé qu'une fois référencé par un règlement enregistré : toute autre
    // sortie (refus, échec, saisie rejouée) le supprime dans le finally, jamais après le commit.
    let proofRecorded = false;
    try {
      if (err) {
        const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Justificatif trop volumineux : 8 Mo maximum."
          : "Justificatif invalide. Formats acceptés : PDF, JPG, PNG, WEBP.";
        return next(new AppError(400, message, { cause: err }));
      }

      if (!req.user) {
        return next(new AppError(401, "Utilisateur non authentifié"));
      }

      const invoiceId = parseRouteId(req.params.id, "ID facture invalide");

      if (!req.file) {
        return next(new AppError(400, "Justificatif requis : joignez une image ou un PDF du règlement."));
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
        // Compte du journal de trésorerie (lot T3, facultatif) : vide = pas d'écriture au journal.
        treasuryAccountId: readField(req.body?.treasuryAccountId) || undefined,
        notes: readField(req.body?.notes),
      };

      const payload = z.object({
        amount: z.coerce.number().positive(),
        paymentMethod: z.enum(["virement", "cheque", "especes", "mobile", "autre"]),
        paymentReference: z.string().trim().min(1),
        paymentDate: z.string().trim().min(1),
        valueDate: z.string().trim().optional(),
        treasuryAccount: z.string().trim().optional(),
        treasuryAccountId: z.coerce.number().int().positive().max(MAX_DB_INTEGER_ID).optional(),
        notes: z.string().trim().optional(),
      }).parse(normalizedPayload);

      const proofReference = `${SETTLEMENT_PROOF_PREFIX}${req.file.filename}`;

      const { settlement, invoice, replayed } = await threeWayMatchingService.recordInvoiceSettlement(
        invoiceId,
        req.user.id,
        {
          amount: payload.amount,
          paymentMethod: payload.paymentMethod,
          paymentReference: payload.paymentReference,
          paymentDate: payload.paymentDate,
          valueDate: payload.valueDate || undefined,
          treasuryAccount: payload.treasuryAccount || undefined,
          treasuryAccountId: payload.treasuryAccountId,
          proofReference,
          notes: payload.notes || undefined,
        }
      );

      // Saisie rejouée : le règlement existe déjà avec son propre justificatif,
      // le fichier qui vient d'arriver ne sert à rien (supprimé par le finally), et rien n'a changé.
      if (replayed) {
        return res.status(200).json({
          invoice,
          settlement,
          message: "Ce règlement était déjà enregistré.",
        });
      }
      proofRecorded = true;

      // Diffusion au mieux : le règlement référence déjà le fichier, un échec ici ne touche ni à l'un ni à l'autre.
      try {
        broadcastSupplierInvoiceUpdate("supplier_invoice_settlement_recorded", {
          invoiceId: invoice.id,
          purchaseOrderId: invoice.purchaseOrderId ?? null,
          invoice,
          settlement,
          action: "settlement_recorded",
          triggeredBy: req.user.id,
        });
      } catch (broadcastError) {
        log.error({ err: broadcastError, requestId: req.requestId, invoiceId }, "diffusion du règlement fournisseur");
      }

      return res.status(201).json({
        invoice,
        settlement,
        message: "Règlement saisi. En attente de rapprochement bancaire.",
      });
    } catch (error) {
      // Le gestionnaire central journalise et rend une erreur lisible :
      // ZodError -> 400 par champ, AppError -> son statut, le reste -> 500 générique.
      return next(error);
    } finally {
      if (!proofRecorded) removeUploadedProof(req);
    }
  });
});

/** Supprime le justificatif reçu, borné au dossier des justificatifs (liens résolus : settlementProofPath). */
function removeUploadedProof(req: Request) {
  if (!req.file) return;
  const proofPath = settlementProofPath(`${SETTLEMENT_PROOF_PREFIX}${req.file.filename}`);
  if (!proofPath || !fs.existsSync(proofPath)) return;
  try {
    fs.unlinkSync(proofPath);
  } catch (unlinkError) {
    log.error({ err: unlinkError, requestId: req.requestId }, "suppression du justificatif téléversé impossible");
  }
}

/**
 * PATCH /api/supplier-invoices/:id/settlements/:settlementId/reconcile
 * Rapprocher un règlement saisi avec la preuve bancaire
 */
router.patch("/:id/settlements/:settlementId/reconcile", checkPaymentPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseRouteId(req.params.id, "ID invalide");
    const settlementId = parseRouteId(req.params.settlementId, "ID invalide");

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
    next(error);
  }
});

/**
 * PATCH /api/supplier-invoices/:id/settlements/:settlementId/reject
 * Rejeter un règlement saisi, motif obligatoire (SINV1)
 */
router.patch("/:id/settlements/:settlementId/reject", checkPaymentPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError(401, "Utilisateur non authentifié");
    }
    const invoiceId = parseRouteId(req.params.id, "Identifiant invalide.");
    const settlementId = parseRouteId(req.params.settlementId, "Identifiant invalide.");
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";

    const result = await threeWayMatchingService.rejectInvoiceSettlement(invoiceId, settlementId, req.user.id, reason);

    if (!result.replayed) {
      broadcastSupplierInvoiceUpdate("supplier_invoice_settlement_rejected", {
        invoiceId,
        settlement: result.settlement,
        action: "settlement_rejected",
        triggeredBy: req.user.id,
      });
    }

    res.json({ settlement: result.settlement, message: "Règlement rejeté" });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/supplier-invoices/:id/payment
 * Enregistrer le règlement d'une facture (endpoint legacy compat)
 */
router.post("/:id/payment", checkPaymentPermission, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const invoiceId = parseRouteId(req.params.id, "Identifiant de facture invalide.");
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
    next(error);
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
    fileSize: SUPPLIER_INVOICE_IMPORT_MAX_FILE_BYTES
  }
}).single('file');

/**
 * POST /api/supplier-invoices/import
 * Importer des factures depuis un fichier Excel (modèle de `import-excel-dialog.tsx`).
 * Chaque ligne passe par la même saisie que `POST /` ; une ligne refusée porte un
 * message lisible et n'empêche pas les autres.
 */
const IMPORT_MAX_AMOUNT = 1_000_000_000_000;

/** Erreur d'une ligne d'import : son message est rédigé pour l'utilisateur. */
class ImportRowError extends Error {}

function formatIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) || year < 1900 || year > 2200 ||
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseImportDate(value: unknown, label: string): string {
  let iso: string | null = null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    iso = parsed ? formatIsoDate(parsed.y, parsed.m, parsed.d) : null;
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    iso = formatIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? "").trim());
    iso = match ? formatIsoDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
  }
  if (!iso) {
    throw new ImportRowError(`${label} invalide : date attendue au format JJ/MM/AAAA.`);
  }
  return iso;
}

function parseImportAmount(value: unknown, label: string): number {
  const amount = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0 || amount > IMPORT_MAX_AMOUNT) {
    throw new ImportRowError(`${label} invalide : nombre positif attendu.`);
  }
  return amount;
}

/** Ne garde que les colonnes attendues : un en-tête `__proto__` ou `constructor` est ignoré. */
function pickImportColumns(raw: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of SUPPLIER_INVOICE_IMPORT_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(raw, column)) row[column] = raw[column];
  }
  return row;
}

router.post("/import", checkCreatePermission, (req: Request, res: Response, next: NextFunction) => {
  uploadExcel(req, res, async (err) => {
    if (err) {
      const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "Fichier trop volumineux : 5 Mo maximum."
        : "Seuls les fichiers Excel (.xlsx) sont acceptés.";
      return next(new AppError(400, message, { cause: err }));
    }

    if (!req.file) {
      return next(new AppError(400, "Aucun fichier fourni."));
    }

    try {
      let data: Record<string, unknown>[];
      try {
        // SheetJS ne lit jamais le tampon téléversé : seulement l'archive reconstruite par la
        // garde à partir des contenus réellement décompressés (tailles vraies par construction).
        const archive = canonicalWorkbookArchive(req.file.buffer, SUPPLIER_INVOICE_IMPORT_MAX_UNCOMPRESSED_BYTES);
        // Lecture complète, sans fenêtre de lignes : le volume est déjà borné par la garde.
        const workbook = XLSX.read(archive, {
          type: "buffer",
          sheets: 0,
          cellFormula: false,
          cellHTML: false,
          cellStyles: false,
          dense: true,
        });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const sheet = worksheet ? compactImportSheet(worksheet) : null;
        const rawRows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet) : [];
        if (rawRows.length > SUPPLIER_INVOICE_IMPORT_MAX_ROWS) {
          throw importTooLongError(`${rawRows.length} lignes de données trouvées`);
        }
        data = rawRows.map(pickImportColumns);
      } catch (parseError) {
        if (parseError instanceof AppError) throw parseError;
        log.warn({ err: parseError, requestId: req.requestId }, "Classeur d'import de facture fournisseur illisible");
        throw new AppError(400, "Fichier Excel illisible.", { cause: parseError });
      }

      const results = {
        success: 0,
        failed: 0,
        total: data.length,
        errors: [] as Array<{ row: number; message: string }>
      };

      // Rien à importer : pas de lecture des référentiels (toutes les factures existantes).
      if (data.length === 0) return res.json(results);

      // Fournisseurs, factures et commandes lus une seule fois.
      const suppliers = await supplierManagementService.getSuppliers();
      const supplierMap = new Map<string, (typeof suppliers)[number]>(
        suppliers.map(s => [s.name.toLowerCase().trim(), s])
      );

      const existingInvoices = await threeWayMatchingService.getSupplierInvoices({});
      const existingInvoiceNumbers = new Set(
        existingInvoices.map(inv => inv.invoiceNumber.toLowerCase().trim())
      );

      const orderNumbers = Array.from(new Set(
        data.map(r => r['N° Commande']).filter(v => !isBlankCell(v)).map(v => String(v).trim())
      ));
      const orderMap = new Map<string, { id: number; supplierId: number | null }>();
      if (orderNumbers.length > 0) {
        const orders = await db
          .select({ id: purchaseOrders.id, orderNumber: purchaseOrders.orderNumber, supplierId: purchaseOrders.supplierId })
          .from(purchaseOrders)
          .where(inArray(purchaseOrders.orderNumber, orderNumbers));
        for (const order of orders) orderMap.set(order.orderNumber, order);
      }

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNumber = i + 2; // ligne 1 = en-tête

        try {
          const required: Array<[string, string]> = [
            ['Numéro Facture', "Numéro de facture manquant."],
            ['Fournisseur', "Fournisseur manquant."],
            ['Date Facture', "Date de facture manquante."],
            ['Date Échéance', "Date d'échéance manquante."],
            ['Montant HT', "Montant HT manquant."],
            ['Montant TTC', "Montant TTC manquant."],
          ];
          for (const [column, message] of required) {
            if (isBlankCell(row[column])) throw new ImportRowError(message);
          }

          const invoiceNumber = String(row['Numéro Facture']).trim();
          if (existingInvoiceNumbers.has(invoiceNumber.toLowerCase())) {
            throw new ImportRowError(`La facture « ${invoiceNumber} » existe déjà.`);
          }

          const supplier = supplierMap.get(String(row['Fournisseur']).toLowerCase().trim());
          if (!supplier) {
            throw new ImportRowError(`Fournisseur « ${String(row['Fournisseur']).trim()} » introuvable.`);
          }

          const invoiceDate = parseImportDate(row['Date Facture'], "Date de facture");
          const dueDate = parseImportDate(row['Date Échéance'], "Date d'échéance");

          const totalHT = parseImportAmount(row['Montant HT'], "Montant HT");
          const totalTTC = parseImportAmount(row['Montant TTC'], "Montant TTC");
          if (totalHT <= 0) {
            throw new ImportRowError("Montant HT invalide : nombre positif attendu.");
          }
          if (totalTTC < totalHT) {
            throw new ImportRowError("Le montant TTC ne peut pas être inférieur au montant HT.");
          }
          const vatAmount = Math.round((totalTTC - totalHT) * 100) / 100;

          if (!isBlankCell(row['TVA (%)'])) {
            const expectedVatRate = parseImportAmount(row['TVA (%)'], "TVA (%)");
            const calculatedVatRate = (vatAmount / totalHT) * 100;
            if (Math.abs(calculatedVatRate - expectedVatRate) > 0.5) {
              throw new ImportRowError(
                `TVA incohérente : taux indiqué ${expectedVatRate.toFixed(2)} %, calculé ${calculatedVatRate.toFixed(2)} %.`
              );
            }
          }

          let purchaseOrderId: number | undefined;
          if (!isBlankCell(row['N° Commande'])) {
            const orderNumber = String(row['N° Commande']).trim();
            const order = orderMap.get(orderNumber);
            if (!order) {
              throw new ImportRowError(`Commande « ${orderNumber} » introuvable.`);
            }
            if (order.supplierId !== null && order.supplierId !== supplier.id) {
              throw new ImportRowError(`La commande « ${orderNumber} » appartient à un autre fournisseur.`);
            }
            purchaseOrderId = order.id;
          }

          // Même saisie que POST / : les champs du workflow ne sont jamais fournis par l'import.
          const invoiceData = createSupplierInvoiceSchema.parse({
            invoiceNumber,
            supplierId: supplier.id,
            purchaseOrderId,
            invoiceDate,
            dueDate,
            amountHT: totalHT.toFixed(2),
            vatAmount: vatAmount.toFixed(2),
            totalTTC: totalTTC.toFixed(2),
          });

          const result = await threeWayMatchingService.createSupplierInvoice(invoiceData, req.user!.id);
          existingInvoiceNumbers.add(invoiceNumber.toLowerCase());
          results.success++;

          broadcastSupplierInvoiceUpdate("supplier_invoice_created", {
            invoiceId: result.invoice.id,
            purchaseOrderId: result.invoice.purchaseOrderId ?? null,
            invoice: result.invoice,
            action: "imported",
            triggeredBy: req.user!.id,
          });
        } catch (error) {
          results.failed++;
          let message: string;
          if (error instanceof ImportRowError || error instanceof AppError) {
            message = error.message;
          } else {
            log.error({ err: error, requestId: req.requestId, row: rowNumber }, "Ligne d'import de facture fournisseur en échec");
            message = `Ligne non importée. Référence : ${req.requestId ?? "inconnue"}`;
          }
          results.errors.push({ row: rowNumber, message });
        }
      }

      res.json(results);
    } catch (error) {
      next(error);
    }
  });
});

export default router;
