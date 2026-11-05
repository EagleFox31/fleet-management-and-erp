/**
 * Retenues à la source sur une facture client (lot F1) : module pur, sans taux en dur.
 * Les taux viennent de la fiche client (`clients.withholding_vat_rate`, `withholding_is_rate`).
 *
 * Lecture des Excel du client :
 * - retenue TVA = HT × taux (CNPCC : HT × 19,25 %, soit toute la TVA) ;
 * - retenue IS = base × taux, base HT (CNPCC) ou TTC (feuille OPERATION) : la base est un
 *   paramètre tant que la question client n°2 n'est pas tranchée ;
 * - net à payer = TTC − retenue TVA − retenue IS.
 * Chaque montant est arrondi au FCFA, et le net se calcule sur les retenues arrondies : la somme
 * affichée (TTC − retenues) tombe toujours juste.
 */

export type WithholdingBase = "ht" | "ttc";

export interface InvoiceAmounts {
  /** Montant HT en FCFA. */
  amountHt: number;
  /** Montant TTC en FCFA. */
  amountTtc: number;
}

export interface WithholdingRates {
  /** Taux de retenue TVA, en %, appliqué au HT. */
  vatWithholdingRate: number;
  /** Taux de retenue IS, en %, appliqué à `isBase`. */
  isWithholdingRate: number;
  isBase: WithholdingBase;
}

export interface WithholdingResult {
  withholdingVatAmount: number;
  withholdingIsAmount: number;
  netPayable: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Arrondi au franc CFA (pas de subdivision). */
export function roundFcfa(amount: number): number {
  return Math.round(amount);
}

function assertAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} invalide : montant positif attendu.`);
}

function assertRate(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError(`${label} invalide : taux entre 0 et 100 attendu.`);
}

export function computeWithholdings(amounts: InvoiceAmounts, rates: WithholdingRates): WithholdingResult {
  assertAmount(amounts.amountHt, "Montant HT");
  assertAmount(amounts.amountTtc, "Montant TTC");
  assertRate(rates.vatWithholdingRate, "Taux de retenue TVA");
  assertRate(rates.isWithholdingRate, "Taux de retenue IS");

  const isBaseAmount = rates.isBase === "ttc" ? amounts.amountTtc : amounts.amountHt;
  const withholdingVatAmount = roundFcfa((amounts.amountHt * rates.vatWithholdingRate) / 100);
  const withholdingIsAmount = roundFcfa((isBaseAmount * rates.isWithholdingRate) / 100);
  const netPayable = roundFcfa(amounts.amountTtc) - withholdingVatAmount - withholdingIsAmount;
  return { withholdingVatAmount, withholdingIsAmount, netPayable };
}

function utcDay(isoDate: string, label: string): number {
  if (!ISO_DATE.test(isoDate)) throw new RangeError(`${label} invalide : format AAAA-MM-JJ attendu.`);
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/**
 * Jours écoulés depuis le dépôt de la facture chez le client (« COMPTEUR NBRE DE JOURS »,
 * `TODAY() − date de dépôt`). Calcul sur dates calendaires, sans heure : pas d'effet de fuseau.
 * `null` tant que la facture n'est pas déposée.
 */
export function daysSinceDeposit(depositedAt: string | null | undefined, today: string): number | null {
  if (depositedAt === null || depositedAt === undefined) return null;
  return utcDay(today, "Date du jour") - utcDay(depositedAt, "Date de dépôt");
}
