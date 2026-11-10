export const toCents = (value: string | number): number => Math.round(Number(value) * 100);

/** TVA en centimes : taux de la facture (ex. 19.25 ou 0), calcul en entiers, arrondi au centime. */
export function creditNoteAmounts(amountHt: number, vatRate: string | number | null | undefined) {
  const htCents = toCents(amountHt);
  const rateBp = Math.round(Number(vatRate ?? 0) * 100); // 19.25 % -> 1925
  const vatCents = Math.round((htCents * rateBp) / 10000);
  return { htCents, vatCents, ttcCents: htCents + vatCents };
}
