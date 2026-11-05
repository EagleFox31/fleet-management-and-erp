/**
 * Factures en attente (P-21) : opérations client terminées pas encore
 * facturées. Lecture seule. Drapeau `pending-invoices`.
 */
import { z } from "zod";
import { isoDateSchema } from "./common";

export const PENDING_INVOICES_PATH = "/api/billing/pending-invoices";

export const pendingInvoiceSchema = z.object({
  clientId: z.number().int(),
  clientName: z.string(),
  operationCount: z.number().int().min(1),
  /** Somme des prix convenus (XAF) des opérations qui en portent un. */
  amount: z.number().min(0),
  /** Opérations sans prix convenu : non valorisées, jamais comptées pour 0. */
  missionsWithoutPrice: z.number().int().min(0),
  oldestOperationDate: isoDateSchema,
});

export const pendingInvoicesResponseSchema = z.array(pendingInvoiceSchema);

export type PendingInvoice = z.infer<typeof pendingInvoiceSchema>;
