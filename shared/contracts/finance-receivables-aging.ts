/**
 * Balance âgée des créances clients : factures en attente de paiement (`invoices-awaiting-payment.ts`,
 * statuts pending, partial, overdue) réparties par ancienneté, par client et au total.
 *
 * - Ancienneté = jours écoulés depuis le dépôt chez le client (`daysSinceDeposit`), à Africa/Douala.
 *   Tranches bornes incluses : 0 à 30, 31 à 60, 61 à 90, plus de 90 jours. Une facture pas encore
 *   déposée n'a pas d'ancienneté : elle va dans `notDeposited`.
 * - Montants par tranche :
 *   - `amountDue` : reste dû, TTC moins les règlements enregistrés (`balanceDue` de la liste). C'est
 *     le montant à relancer ; cohérent avec le solde du relevé client.
 *   - `amountTtc` : TTC facturé, sans déduction, pour la transparence.
 *   - `netPayable` : TTC moins retenues (figées au dépôt), sans déduction des règlements. Un « net
 *     restant » (retenues et règlements) n'est pas couvert : point ouvert.
 * - Sommes faites en centimes entiers : `total` = somme exacte des tranches.
 * Lecture seule, aucun paramètre. Drapeau `finance`. Rôles : `FINANCE_RECEIVABLE_READ_ROLES`.
 */
import { z } from "zod";
import { MAX_DB_INTEGER_ID, isoDateSchema } from "./common";

export const FINANCE_RECEIVABLES_AGING_PATH = "/api/finance/receivables-aging";

export const AGING_BUCKETS = ["notDeposited", "days0to30", "days31to60", "days61to90", "over90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Aucun paramètre accepté. */
export const financeReceivablesAgingQuerySchema = z.object({}).strict();

export const agingAmountsSchema = z.object({
  count: z.number().int().min(0),
  amountDue: z.number(),
  amountTtc: z.number().min(0),
  netPayable: z.number(),
});

const agingRowShape = {
  notDeposited: agingAmountsSchema,
  days0to30: agingAmountsSchema,
  days31to60: agingAmountsSchema,
  days61to90: agingAmountsSchema,
  over90: agingAmountsSchema,
  /** Somme des cinq tranches. */
  total: agingAmountsSchema,
};

export const agingRowSchema = z.object(agingRowShape);

export const financeReceivablesAgingResponseSchema = z.object({
  /** Date de calcul de l'ancienneté (aujourd'hui à Africa/Douala). */
  asOf: isoDateSchema,
  /** Un client par ligne, trié par nom ; factures sans client rattaché en dernier. */
  byClient: z.array(
    z.object({
      clientId: z.number().int().positive().max(MAX_DB_INTEGER_ID).nullable(),
      clientName: z.string().nullable(),
      ...agingRowShape,
    }),
  ),
  totals: agingRowSchema,
});

export type AgingAmounts = z.infer<typeof agingAmountsSchema>;
export type AgingRow = z.infer<typeof agingRowSchema>;
export type FinanceReceivablesAgingResponse = z.infer<typeof financeReceivablesAgingResponseSchema>;
