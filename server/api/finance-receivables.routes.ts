import { Router } from "express";
import { FINANCE_RECEIVABLE_READ_ROLES, FINANCE_RECEIVABLE_WRITE_ROLES } from "@shared/constants/roles";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  clientWithholdingRequestSchema,
  invoiceDepositRequestSchema,
} from "@shared/contracts/invoices-awaiting-payment";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { parseRouteId } from "../lib/route-id";
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
