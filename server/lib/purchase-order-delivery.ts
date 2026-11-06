/**
 * Réception globale d'une commande fournisseur : quelles lignes s'alignent sur le commandé, et de
 * combien le stock monte pour chacune.
 *
 * Une seule règle sert aux deux : une ligne encore ouverte (`pending`, `partial`) passe à
 * `delivered` avec reçu = commandé, et le stock est crédité de l'écart. Une ligne déjà close
 * (`delivered`, `accepted`, `rejected`) n'est ni alignée ni créditée, même si son reçu est inférieur
 * au commandé : sa réception a été arrêtée ligne par ligne.
 *
 * Invariant : chaque hausse de `quantityReceived` est créditée en stock, et rien d'autre.
 */

export const OPEN_LINE_DELIVERY_STATUSES: readonly string[] = ["pending", "partial"];

export interface DeliveryLine {
  lineId: number;
  partId: number | null;
  quantityOrdered: number | null;
  quantityReceived: number | null;
  deliveryStatus: string | null;
}

export interface DeliveryReceipt {
  lineId: number;
  partId: number | null;
  /** Quantité reçue après alignement. */
  receivedAfter: number;
  /** Entrée en stock correspondante (0 si rien à créditer). */
  stockIn: number;
}

export function deliveryReceipts(lines: readonly DeliveryLine[]): DeliveryReceipt[] {
  return lines
    .filter((line) => OPEN_LINE_DELIVERY_STATUSES.includes(line.deliveryStatus ?? "pending"))
    .map((line) => {
      const ordered = line.quantityOrdered ?? 0;
      const received = line.quantityReceived ?? 0;
      // Un reçu déjà supérieur au commandé n'est pas réduit : le stock crédité ne serait pas repris.
      const receivedAfter = Math.max(received, ordered);
      return {
        lineId: line.lineId,
        partId: line.partId,
        receivedAfter,
        stockIn: line.partId ? receivedAfter - received : 0,
      };
    });
}
