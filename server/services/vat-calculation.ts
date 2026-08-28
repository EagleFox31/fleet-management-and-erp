/** TVA par défaut au Cameroun. */
export const DEFAULT_VAT_RATE = 19.25;

export type VatBreakdown = {
  amountHT: number;
  vatRate: number;
  vatAmount: number;
  totalTTC: number;
};

export function calculateVAT(
  amountHT: number,
  vatRate: number = DEFAULT_VAT_RATE,
): VatBreakdown {
  const vatAmount = (amountHT * vatRate) / 100;
  return {
    amountHT,
    vatRate,
    vatAmount: Math.round(vatAmount),
    totalTTC: Math.round(amountHT + vatAmount),
  };
}
