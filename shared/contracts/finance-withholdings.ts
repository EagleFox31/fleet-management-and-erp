/**
 * Récapitulatif des retenues à la source subies sur une période (lot F1, suite) : déclaration fiscale
 * et rapprochement des attestations de retenue des clients.
 *
 * - Factures retenues : déposées chez le client (`deposited_at`) entre `from` et `to`, bornes incluses,
 *   et non annulées. Une facture soldée depuis reste comptée : la retenue a été subie.
 * - Montants : ceux figés au dépôt (`client_invoices.withholding_*`, `net_payable`), jamais recalculés
 *   depuis les taux actuels du client.
 * - Dates : `deposited_at` est une date sans heure, comparée telle quelle. Par défaut, `to` vaut la date
 *   du jour à Africa/Douala et `from` le premier jour du mois de `to`. Période de 36 mois au plus
 *   (`KPI_MAX_SPAN_MONTHS`) ; `clientId` absent ou vide : tous les clients.
 * Lecture seule. Drapeau `finance`. Rôles : `FINANCE_RECEIVABLE_READ_ROLES`.
 */
import { z } from "zod";
import { MAX_DB_INTEGER_ID, isoDateSchema } from "./common";

export const FINANCE_WITHHOLDINGS_PATH = "/api/finance/withholdings";

export const financeWithholdingsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** Lu strictement par le serveur (`parseRouteId`) : entier positif dans la plage des identifiants. */
    clientId: z.string().optional(),
  })
  .strict();

const id = z.number().int().positive().max(MAX_DB_INTEGER_ID);
const fcfa = z.number().min(0);

const amountsSchema = z.object({
  count: z.number().int().min(0),
  amountHt: fcfa,
  amountTtc: fcfa,
  withholdingVatAmount: fcfa,
  withholdingIsAmount: fcfa,
  netPayable: z.number(),
});

export const financeWithholdingLineSchema = z.object({
  invoiceId: id,
  invoiceNumber: z.string(),
  /** `null` : facture sans client rattaché. */
  clientId: id.nullable(),
  clientName: z.string().nullable(),
  depositedAt: isoDateSchema,
  amountHt: fcfa,
  amountTtc: fcfa,
  withholdingVatAmount: fcfa,
  withholdingIsAmount: fcfa,
  netPayable: z.number(),
});

export const financeWithholdingsResponseSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  clientId: id.nullable(),
  /** Par date de dépôt, puis numéro de facture. */
  items: z.array(financeWithholdingLineSchema),
  /** Une ligne par client, triée par nom. */
  byClient: z.array(amountsSchema.extend({ clientId: id.nullable(), clientName: z.string().nullable() })),
  totals: amountsSchema,
});

export type FinanceWithholdingsQuery = z.infer<typeof financeWithholdingsQuerySchema>;
export type FinanceWithholdingLine = z.infer<typeof financeWithholdingLineSchema>;
export type FinanceWithholdingsResponse = z.infer<typeof financeWithholdingsResponseSchema>;
