import { getPartRequirementStatusLabel } from "@shared/constants/part-requirements";

/**
 * Demande de pièce depuis un OT : le serveur décide au clic. Ce qui est en
 * rayon (stock non promis à une autre demande) part dans la file du magasinier,
 * « à sortir » ; le reste part en demande et l'OT passe en attente de pièces.
 * Rien ne sort ici : le stock ne bouge qu'à la sortie par le magasin.
 */
export function splitPartRequest(quantity: number, stockAvailable: number): { inStock: number; missing: number } {
  const inStock = Math.min(quantity, Math.max(0, stockAvailable));
  return { inStock, missing: quantity - inStock };
}

export function describePartRequest(outcome: {
  toIssue: number;
  missing: number;
  /** Statut de la demande déjà en cours, réutilisée au lieu d'en créer une. */
  existingStatus?: string | null;
}): string {
  const { toIssue, missing, existingStatus } = outcome;
  if (existingStatus) {
    return `Une demande est déjà en cours pour cette pièce (${getPartRequirementStatusLabel(existingStatus)}).`;
  }
  const rayon =
    toIssue > 0
      ? `${toIssue} en rayon : demande transmise au magasinier, qui sortira la pièce.`
      : "Aucune pièce disponible en rayon.";
  if (missing === 0) return rayon;
  return `${rayon} Demande de pièce créée pour ${missing} unité(s) manquante(s). L'OT est en attente de pièces.`;
}
