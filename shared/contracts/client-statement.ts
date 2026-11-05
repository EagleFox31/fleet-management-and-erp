/**
 * Relevé de compte client : factures (débit) et paiements (crédit) d'un client, solde courant.
 * Lecture seule. Drapeau `finance`. Rôles : lecture finance (`FINANCE_RECEIVABLE_READ_ROLES`).
 *
 * - Montants en FCFA, TTC (les retenues à la source restent sur l'écran des factures en attente).
 * - Factures annulées exclues, avec leurs paiements.
 * - `from` absent : depuis la première écriture, solde d'ouverture 0. `to` absent : aujourd'hui (Douala).
 * - Ordre des lignes : date, facture avant paiement le même jour, puis id.
 */
import { z } from "zod";
import { MAX_DB_INTEGER_ID, dateRangeQuerySchema, isoDateSchema } from "./common";

export const clientStatementPath = (clientId: number | string) => `/api/clients/${clientId}/statement`;

export const clientStatementQuerySchema = dateRangeQuerySchema;

const id = z.number().int().positive().max(MAX_DB_INTEGER_ID);
const fcfa = z.number().min(0);

export const clientStatementLineSchema = z.object({
  date: isoDateSchema,
  kind: z.enum(["invoice", "payment"]),
  invoiceId: id,
  invoiceNumber: z.string(),
  /** Paiement seulement : n° de chèque, référence de virement. */
  reference: z.string().nullable(),
  /** Paiement seulement. */
  paymentMethod: z.enum(["cash", "bank_transfer", "check", "mobile_money", "other"]).nullable(),
  debit: fcfa,
  credit: fcfa,
  /** Solde après la ligne : positif = dû par le client. */
  balance: z.number(),
});

export const clientStatementResponseSchema = z.object({
  client: z.object({ id, name: z.string() }),
  from: isoDateSchema.nullable(),
  to: isoDateSchema,
  openingBalance: z.number(),
  lines: z.array(clientStatementLineSchema),
  totals: z.object({ debit: fcfa, credit: fcfa }),
  closingBalance: z.number(),
});

export type ClientStatementLine = z.infer<typeof clientStatementLineSchema>;
export type ClientStatementResponse = z.infer<typeof clientStatementResponseSchema>;
