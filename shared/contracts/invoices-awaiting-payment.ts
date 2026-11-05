/**
 * Factures en attente de paiement (lot F1) : factures client émises, pas encore réglées,
 * avec retenues à la source et compteur de jours depuis le dépôt (feuille Excel CNPCC).
 * Lecture seule. Drapeau `finance`. Calculs : `shared/finance/withholding.ts`.
 *
 * À ne pas confondre avec `pending-invoices.ts` (P-21) : opérations terminées pas encore facturées.
 */
import { z } from "zod";
import { MAX_DB_INTEGER_ID, isoDateSchema } from "./common";

export const INVOICES_AWAITING_PAYMENT_PATH = "/api/finance/invoices-awaiting-payment";

const fcfa = z.number().min(0);

export const invoiceAwaitingPaymentSchema = z.object({
  invoiceId: z.number().int().positive().max(MAX_DB_INTEGER_ID),
  invoiceNumber: z.string(),
  clientId: z.number().int().positive().max(MAX_DB_INTEGER_ID),
  clientName: z.string(),
  amountHt: fcfa,
  amountTtc: fcfa,
  withholdingVatAmount: fcfa,
  withholdingIsAmount: fcfa,
  netPayable: z.number(),
  /** Date de dépôt chez le client ; `null` tant que la facture n'est pas déposée. */
  depositedAt: isoDateSchema.nullable(),
  daysSinceDeposit: z.number().int().min(0).nullable(),
});

export const invoicesAwaitingPaymentTotalsSchema = z.object({
  count: z.number().int().min(0),
  amountHt: fcfa,
  amountTtc: fcfa,
  withholdingVatAmount: fcfa,
  withholdingIsAmount: fcfa,
  netPayable: z.number(),
});

export const invoicesAwaitingPaymentResponseSchema = z.object({
  items: z.array(invoiceAwaitingPaymentSchema),
  totals: invoicesAwaitingPaymentTotalsSchema,
});

export type InvoiceAwaitingPayment = z.infer<typeof invoiceAwaitingPaymentSchema>;
export type InvoicesAwaitingPaymentTotals = z.infer<typeof invoicesAwaitingPaymentTotalsSchema>;
export type InvoicesAwaitingPaymentResponse = z.infer<typeof invoicesAwaitingPaymentResponseSchema>;
