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
  /** Base de la retenue IS utilisée pour la ligne (affichée : question client n°2 ouverte). */
  withholdingIsBase: z.enum(["ht", "ttc"]),
  /** Retenues figées au dépôt (`true`) ou calculées depuis les taux actuels du client. */
  withholdingFrozen: z.boolean(),
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

/** `PATCH {PATH}/:id/deposit` : date de dépôt chez le client (fige les retenues). */
export const invoiceDepositRequestSchema = z.object({ depositedAt: isoDateSchema }).strict();

// Deux décimales au plus : la colonne est numeric(5,2), une troisième serait arrondie en base.
const rate = z
  .number()
  .min(0, "Le taux doit être compris entre 0 et 100.")
  .max(100, "Le taux doit être compris entre 0 et 100.")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Deux décimales au plus.")
  .nullable();

/** `PATCH /api/finance/clients/:id/withholding` : taux en %, `null` = pas de retenue. */
export const CLIENT_WITHHOLDING_PATH = "/api/finance/clients";
export const clientWithholdingRequestSchema = z.object({
  vatWithholdingRate: rate,
  isWithholdingRate: rate,
  isBase: z.enum(["ht", "ttc"]),
}).strict();

export type InvoiceDepositRequest = z.infer<typeof invoiceDepositRequestSchema>;
export type ClientWithholdingRequest = z.infer<typeof clientWithholdingRequestSchema>;
export type InvoiceAwaitingPayment =z.infer<typeof invoiceAwaitingPaymentSchema>;
export type InvoicesAwaitingPaymentTotals = z.infer<typeof invoicesAwaitingPaymentTotalsSchema>;
export type InvoicesAwaitingPaymentResponse = z.infer<typeof invoicesAwaitingPaymentResponseSchema>;
