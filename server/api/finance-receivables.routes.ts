import { Router } from "express";
import { FINANCE_RECEIVABLE_READ_ROLES, FINANCE_RECEIVABLE_WRITE_ROLES } from "@shared/constants/roles";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  clientWithholdingRequestSchema,
  invoiceDepositRequestSchema,
} from "@shared/contracts/invoices-awaiting-payment";
import { financeWithholdingsQuerySchema } from "@shared/contracts/finance-withholdings";
import { KPI_MAX_SPAN_MONTHS, isoDateInZone, spanInMonths } from "@shared/contracts/kpi-period";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { withholdingsSummary } from "../services/finance-withholdings-service";
import { moduleLogger } from "../lib/logger";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { authorize } from "../middleware/auth";
import {
  depositInvoice,
  listInvoicesAwaitingPayment,
  updateClientWithholding,
} from "../services/finance-receivables-service";

const log = moduleLogger("finance-receivables");
const router = Router();

// Monté sur /api : chemins complets, drapeau sur chaque route (modèle pending-invoices.routes.ts).
const finance = requireFeature("finance");
const CLIENT_ID_INVALID = "Identifiant de client invalide.";

function emit(event: "client_invoice_deposited" | "client_withholding_updated", id: number, requestId?: string): void {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  if (typeof broadcast !== "function") {
    log.warn({ requestId, event }, "diffusion temps réel indisponible");
    return;
  }
  broadcast(event, { id, scope: REALTIME_EVENTS[event].scope });
}

/** Factures émises non soldées, avec retenues et compteur de jours depuis le dépôt. */
router.get("/finance/invoices-awaiting-payment", finance, authorize([...FINANCE_RECEIVABLE_READ_ROLES]), async (_req, res, next) => {
  try {
    res.json(await listInvoicesAwaitingPayment());
  } catch (err) {
    next(err);
  }
});

/**
 * Retenues subies sur une période (dépôt entre `from` et `to` inclus). Défauts : `to` = aujourd'hui
 * à Africa/Douala, `from` = premier jour du mois de `to`. Montants figés au dépôt, jamais recalculés.
 */
router.get("/finance/withholdings", finance, authorize([...FINANCE_RECEIVABLE_READ_ROLES]), async (req, res, next) => {
  try {
    const parsed = financeWithholdingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Valeur répétée ou tableau (`?from[]=x`), paramètre inconnu : le message de zod est technique.
      const issue = parsed.error.issues[0];
      if (issue?.code === "unrecognized_keys") throw new AppError(400, "Paramètre non reconnu.");
      if (issue?.code === "invalid_type") {
        throw new AppError(400, issue.path[0] === "clientId" ? CLIENT_ID_INVALID : "Période invalide.");
      }
      throw new AppError(400, issue?.message ?? "Période invalide.");
    }
    const today = isoDateInZone(new Date());
    const to = parsed.data.to ?? today;
    const from = parsed.data.from ?? `${to.slice(0, 8)}01`;
    if (parsed.data.to === undefined && from > today) {
      throw new AppError(400, "La date de début ne peut pas dépasser aujourd'hui.");
    }
    if (from > to) throw new AppError(400, "La date de début doit précéder la date de fin.");
    if (spanInMonths(from, to) > KPI_MAX_SPAN_MONTHS) {
      throw new AppError(400, `Période trop longue : ${KPI_MAX_SPAN_MONTHS} mois au plus.`);
    }
    // Absent ou vide : tous les clients.
    const clientId = parseQueryId(parsed.data.clientId, CLIENT_ID_INVALID) ?? null;
    res.json(await withholdingsSummary(from, to, clientId));
  } catch (err) {
    next(err);
  }
});

/** Dépôt chez le client : fige les retenues. Même date rejouée : 200 sans écriture ni diffusion. */
router.patch("/finance/invoices-awaiting-payment/:id/deposit", finance, authorize([...FINANCE_RECEIVABLE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de facture invalide.");
    const { depositedAt } = invoiceDepositRequestSchema.parse(req.body);
    const { item, changed } = await depositInvoice(id, depositedAt, req.user!.id);
    if (changed) emit("client_invoice_deposited", id, req.requestId);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

/** Taux de retenue d'un client (hors fiche client : réservé à la finance). */
router.patch("/finance/clients/:id/withholding", finance, authorize([...FINANCE_RECEIVABLE_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de client invalide.");
    const input = clientWithholdingRequestSchema.parse(req.body);
    const { withholding, changed } = await updateClientWithholding(id, input, req.user!.id);
    if (changed) emit("client_withholding_updated", id, req.requestId);
    res.json(withholding);
  } catch (err) {
    next(err);
  }
});

export default router;
