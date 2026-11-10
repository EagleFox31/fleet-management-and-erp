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

export const toCents = (value: string | number): number => Math.round(Number(value) * 100);

/**
 * Montants d'un avoir en centimes : TVA au taux de la facture (ex. 19.25 ou 0), calcul en entiers, arrondi au
 * centime. Source unique : le service qui l'enregistre et l'écran qui en montre l'aperçu.
 */
export function creditNoteAmounts(amountHt: number, vatRate: string | number | null | undefined) {
  const htCents = toCents(amountHt);
  const rateBp = Math.round(Number(vatRate ?? 0) * 100); // 19.25 % -> 1925
  const vatCents = Math.round((htCents * rateBp) / 10000);
  return { htCents, vatCents, ttcCents: htCents + vatCents };
}

/**
 * Plus grand HT (en unités, 2 décimales) dont le TTC tient dans le solde : l'avoir est plafonné au solde
 * (remboursement hors v1). 0 si le solde est nul ou négatif.
 */
export function maxCreditNoteHtOf(balance: string | number, vatRate: string | number | null | undefined): number {
  const balanceCents = toCents(balance);
  if (!(balanceCents > 0)) return 0;
  const rateBp = Math.round(Number(vatRate ?? 0) * 100);
  let htCents = Math.floor((balanceCents * 10000) / (10000 + rateBp));
  const ttcOf = (cents: number) => creditNoteAmounts(cents / 100, vatRate).ttcCents;
  while (htCents > 0 && ttcOf(htCents) > balanceCents) htCents -= 1;
  while (ttcOf(htCents + 1) <= balanceCents) htCents += 1;
  return htCents / 100;
}
