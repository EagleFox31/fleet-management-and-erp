/**
 * Facture client annulée : elle n'est pas du chiffre facturé. Relevé de compte et rapport de
 * facturation l'excluent, avec ses paiements, par ce même statut.
 */
export const CANCELLED_CLIENT_INVOICE_STATUS = "cancelled" as const;

const toNumber = (value: string | number | null | undefined): number => {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
};

const roundCents = (value: number): number => Math.round(value * 100) / 100;

/**
 * Montant effectivement payé d'une facture (lot V1, avoirs). Un avoir baisse le solde sans être un paiement :
 * payé = TTC - avoirs - solde. Source unique, serveur et écrans.
 */
export function paidTtcOf(invoice: {
  amountTTC: string | number | null | undefined;
  creditedAmountTtc?: string | number | null;
  balance: string | number | null | undefined;
}): number {
  return roundCents(toNumber(invoice.amountTTC) - toNumber(invoice.creditedAmountTtc) - toNumber(invoice.balance));
}

/**
 * Statut d'une facture après un avoir : solde nul = payée ; une facture en retard le reste tant qu'elle n'est pas
 * soldée ; sinon partielle dès que le solde est sous le TTC (paiement ou avoir). Même règle que `recordPayment`.
 */
export function statusAfterBalanceChange(
  currentStatus: string,
  newBalance: number,
  amountTTC: number,
): "pending" | "partial" | "paid" | "overdue" {
  if (newBalance <= 0) return "paid";
  if (currentStatus === "overdue") return "overdue";
  if (newBalance < amountTTC) return "partial";
  return "pending";
}
