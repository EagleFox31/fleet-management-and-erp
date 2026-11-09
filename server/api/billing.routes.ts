import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { clientPayments } from "@shared/schema";
import { clientBillingService } from "../services/client-billing-service";
import { getRevenueByClient, resolveRevenuePeriod } from "../services/client-revenue-service";
import { pdfGenerationService } from "../services/pdf-generation-service";
import { authorize } from "../middleware/auth";
import { CLIENT_BILLING_EVENT_ROLES, CLIENT_BILLING_STATS_ROLES } from "@shared/constants/roles";
import { AppError, isAppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { MAX_DB_INTEGER_ID } from "@shared/contracts/common";

const router = Router();

const recordPaymentSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: "Le montant doit être un nombre." })
    .positive("Le montant doit être supérieur à 0."),
  paymentDate: z.string({ required_error: "La date de paiement est obligatoire." })
    .regex(/^\d{4}-\d{2}-\d{2}/, "La date de paiement est invalide."),
  paymentMethod: z.enum(clientPayments.paymentMethod.enumValues, {
    errorMap: () => ({ message: "Mode de paiement inconnu." }),
  }),
  reference: z.string().trim().max(255).nullish(),
  notes: z.string().nullish(),
});

// Plafond HT : le TTC (HT + 19,25 %) doit tenir dans numeric(15, 2).
const MAX_INVOICE_AMOUNT_HT = 1_000_000_000_000;

// Seuls ces champs sont lus : TVA, TTC, solde, statut et auteur sont calculés par le serveur.
const generateInvoiceSchema = z.object({
  missionId: z.coerce.number({ invalid_type_error: "Mission invalide." })
    .int("Mission invalide.")
    .positive("Mission invalide.")
    .max(MAX_DB_INTEGER_ID, "Mission invalide."),
  amount: z.coerce.number({ invalid_type_error: "Le montant doit être un nombre." })
    .positive("Le montant doit être supérieur à 0.")
    .max(MAX_INVOICE_AMOUNT_HT, "Le montant dépasse le plafond autorisé."),
  dueDate: z.string({ required_error: "La date d'échéance est obligatoire." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La date d'échéance est invalide.")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "La date d'échéance est invalide."),
  includeVAT: z.boolean().optional(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
});

type InvoicePdfItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

const toOptionalString = (value: string | null | undefined): string | undefined =>
  value ?? undefined;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const toDateIfValid = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const resolveMissionDeliveryDates = (mission: Record<string, unknown>) => {
  const plannedDeliveryDate = toDateIfValid(mission.deliveryDate);
  const workflowData = asRecord(mission.workflowData);
  const executionData = asRecord(workflowData?.execution);
  const actualFromWorkflow = toDateIfValid(executionData?.actualDeliveryDate);
  const actualFromCompletedAt = toDateIfValid(mission.completedAt);
  const status = typeof mission.status === "string" ? mission.status : "";
  const fallbackFromStatus =
    (status === "delivered" || status === "completed") ? toDateIfValid(mission.updatedAt) : null;

  const actualDeliveryDate = actualFromWorkflow ?? actualFromCompletedAt ?? fallbackFromStatus ?? null;
  const effectiveDeliveryDate = actualDeliveryDate ?? plannedDeliveryDate ?? null;

  return {
    plannedDeliveryDate,
    actualDeliveryDate,
    effectiveDeliveryDate,
  };
};

const normalizeInvoiceItems = (value: unknown): InvoicePdfItem[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const description = typeof record.description === "string" ? record.description : "";
    const quantity = Number(record.quantity);
    const unitPrice = Number(record.unitPrice);
    const total = Number(record.total);

    if (
      description.length === 0 ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(total)
    ) {
      return [];
    }

    return [{ description, quantity, unitPrice, total }];
  });

  return normalized.length > 0 ? normalized : undefined;
};

// Middleware pour les opérations de facturation client
// Admin: accès complet
// Secretary: créer, consulter, enregistrer paiements  
// Logistics: créer, consulter
const canAccessBilling = authorize([...CLIENT_BILLING_EVENT_ROLES]);
const canReadBillingStatistics = authorize([...CLIENT_BILLING_STATS_ROLES]);
const canRecordPayment = authorize(['admin', 'secretary']);

const broadcastClientInvoiceUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    invoiceId?: number | null;
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
    entity: "client_invoice",
    entityId: options?.invoiceId ?? null,
    payload,
    scope: { type: "roles", roles: [...CLIENT_BILLING_EVENT_ROLES] },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

/**
 * Routes API Facturation Clients
 * 
 * Endpoints:
 * - POST /api/billing/invoices/generate - Générer facture depuis mission
 * - GET /api/billing/invoices - Liste factures clients
 * - POST /api/billing/invoices/:id/payments - Enregistrer paiement
 * - GET /api/billing/invoices/:id/payments - Historique paiements facture
 * - GET /api/billing/reports/:clientName - Rapport facturation client
 * - GET /api/billing/statistics - Statistiques globales facturation
 */

/**
 * POST /api/billing/invoices/generate
 * Générer une facture client depuis une mission
 */
router.post("/invoices/generate", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Un montant négatif ou non numérique devenait une facture négative ou NaN.
    const { missionId, invoiceNumber, amount, dueDate, includeVAT } = generateInvoiceSchema.parse(req.body ?? {});

    if (!req.user?.id) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const result = await clientBillingService.generateInvoiceFromMission(
      missionId,
      {
        invoiceNumber, // Optional - service will auto-generate if undefined
        amount,
        dueDate,
        includeVAT: includeVAT !== false, // TVA 19.25% par défaut
        userId: req.user.id,
      }
    );

    const invoiceId =
      typeof (result as any)?.invoice?.id === "number"
        ? (result as any).invoice.id
        : typeof (result as any)?.id === "number"
          ? (result as any).id
          : null;

    broadcastClientInvoiceUpdate(
      "client_invoice_created",
      {
        missionId,
        result,
      },
      {
        invoiceId,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.json(result);
  } catch (error: unknown) {
    // Le gestionnaire central journalise : ZodError -> 400, AppError -> son statut.
    next(error);
  }
});

/**
 * GET /api/billing/invoices
 * Liste factures clients avec filtres
 */
router.get("/invoices", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientName, clientId, status, startDate, endDate } = req.query;

    const filters: {
      clientName?: string;
      clientId?: number;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    } = {};

    if (clientName) filters.clientName = clientName as string;
    if (clientId) filters.clientId = parseQueryId(clientId, "Identifiant client invalide");
    if (status) filters.status = status as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await clientBillingService.getClientInvoices(filters);

    res.json(result);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching invoices" }));
  }
});

/**
 * GET /api/billing/invoices/summary
 * Résumé agrégé des factures clients (pour KPI dashboard)
 */
router.get("/invoices/summary", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientName, clientId, status, startDate, endDate } = req.query;

    const filters: {
      clientName?: string;
      clientId?: number;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    } = {};

    if (clientName) filters.clientName = clientName as string;
    if (clientId) filters.clientId = parseQueryId(clientId, "Identifiant client invalide");
    if (status) filters.status = status as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await clientBillingService.getClientInvoices(filters);
    res.json(result.summary);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching invoices summary" }));
  }
});

/**
 * GET /api/billing/invoices/:id
 * Détails d'une facture avec client, mission et paiements
 */
router.get("/invoices/:id", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de facture invalide.");
    const invoice = await clientBillingService.getInvoiceById(id);
    const invoicePayload: any = { ...invoice };

    if (invoice?.mission && typeof invoice.mission === "object") {
      const missionRecord = invoice.mission as unknown as Record<string, unknown>;
      const deliveryDates = resolveMissionDeliveryDates(missionRecord);
      invoicePayload.mission = {
        ...missionRecord,
        deliveryDate: deliveryDates.effectiveDeliveryDate,
        plannedDeliveryDate: deliveryDates.plannedDeliveryDate,
        actualDeliveryDate: deliveryDates.actualDeliveryDate,
      };
    }

    res.json(invoicePayload);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching invoice" }));
  }
});

/**
 * POST /api/billing/invoices/:id/payments
 * Enregistrer un paiement pour une facture
 */
router.post("/invoices/:id/payments", canRecordPayment, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Lu avant le corps : un id invalide répond 400 sans rien écrire.
    const id = parseRouteId(req.params.id, "Identifiant de facture invalide.");
    // Un montant non numérique devenait NaN et était écrit tel quel dans le solde.
    const { amount, paymentDate, paymentMethod, reference, notes } = recordPaymentSchema.parse(req.body ?? {});

    if (!req.user?.id) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const result = await clientBillingService.recordPayment(
      id,
      {
        amount,
        paymentDate,
        paymentMethod,
        reference: reference ?? undefined,
        notes: notes ?? undefined,
        userId: req.user.id,
      }
    );

    // Saisie rejouée : rien n'a changé, rien à diffuser.
    if (result.replayed) {
      return res.json(result);
    }

    broadcastClientInvoiceUpdate(
      "client_invoice_payment_recorded",
      {
        invoiceId: id,
        payment: result,
      },
      {
        invoiceId: id,
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
      },
    );

    res.json(result);
  } catch (error: unknown) {
    // Le gestionnaire central journalise : ZodError -> 400 par champ,
    // AppError -> son statut, le reste -> 500 générique avec référence.
    next(error);
  }
});

/**
 * GET /api/billing/invoices/:id/payments
 * Historique des paiements d'une facture
 */
router.get("/invoices/:id/payments", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de facture invalide.");
    const result = await clientBillingService.getInvoicePayments(id);
    res.json(result);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching invoice payments" }));
  }
});

/**
 * GET /api/billing/invoices/:id/pdf
 * Télécharger la facture en PDF
 */
router.get("/invoices/:id/pdf", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de facture invalide.");

    // Récupérer la facture avec tous les détails
    const invoice = await clientBillingService.getInvoiceById(id);

    if (!invoice.client) {
      return res.status(404).json({ error: "Client lié à la facture introuvable" });
    }

    const clientData = {
      name: invoice.client.name,
      address: toOptionalString(invoice.client.address),
      email: toOptionalString(invoice.client.email),
      phone: toOptionalString(invoice.client.phone),
    };

    const missionData = invoice.mission
      ? (() => {
          const missionRecord = invoice.mission as unknown as Record<string, unknown>;
          const deliveryDates = resolveMissionDeliveryDates(missionRecord);
          return {
            orderNumber: String(invoice.mission.orderNumber),
            deliveryAddress: String(invoice.mission.deliveryAddress ?? ""),
            deliveryDate: deliveryDates.effectiveDeliveryDate ?? undefined,
            deliveryDateLabel: deliveryDates.actualDeliveryDate ? "Livraison réelle" : "Livraison prévue",
          };
        })()
      : undefined;

    const itemsData = normalizeInvoiceItems(invoice.items);
    
    // Générer le PDF
    const pdfBuffer = await pdfGenerationService.generateInvoicePDF({
      invoice,
      client: clientData,
      mission: missionData,
      items: itemsData,
    });
    
    // Définir les headers pour le téléchargement
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Facture_${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Envoyer le PDF
    res.send(pdfBuffer);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error generating invoice PDF" }));
  }
});

/**
 * GET /api/billing/reports/:clientName
 * Rapport facturation pour un client (MAERSK, CNPCC, AGL, SODECOTON)
 */
router.get("/reports/:clientName", canAccessBilling, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientName } = req.params;
    const { year, month } = req.query;

    // `parseInt` seul acceptait « abc » (période « NaN ») ou « 2026x » ; mois hors 1-12 : rapport vide silencieux.
    if (year === undefined || year === "") {
      throw new AppError(400, "L'année est requise.");
    }
    if (typeof year !== "string" || !/^\d{4}$/.test(year)) {
      throw new AppError(400, "Année attendue sur quatre chiffres.");
    }
    if (month !== undefined && (typeof month !== "string" || !/^(0?[1-9]|1[0-2])$/.test(month))) {
      throw new AppError(400, "Mois attendu entre 1 et 12.");
    }

    const report = await clientBillingService.getClientBillingReport(
      clientName,
      Number(year),
      month === undefined ? undefined : Number(month)
    );

    res.json(report);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error generating billing report" }));
  }
});

/**
 * GET /api/billing/statistics
 * Statistiques globales de facturation par client
 */
router.get("/statistics", canReadBillingStatistics, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await clientBillingService.getBillingStatistics();
    res.json(stats);
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching billing statistics" }));
  }
});

/**
 * GET /api/billing/revenue/by-client?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Chiffre d'affaires HT réel par client (factures émises de la période) et marge après carburant.
 * Mêmes rôles que les statistiques de facturation ; sans période : le mois en cours (Douala).
 */
router.get("/revenue/by-client", canReadBillingStatistics, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = resolveRevenuePeriod({ from: req.query.from, to: req.query.to });
    res.json(await getRevenueByClient(period));
  } catch (error: unknown) {
    next(withLogContext(isAppError(error) ? error : new AppError(500, "Erreur serveur.", { cause: error }), { event: "Error fetching revenue by client" }));
  }
});

export default router;
