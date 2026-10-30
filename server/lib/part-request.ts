import { getPartRequirementStatusLabel } from "@shared/constants/part-requirements";

/**
 * Demande de pièce depuis un OT : le serveur décide au clic. Ce qui est en
 * stock sort tout de suite (réservé à cet OT), le reste part en demande et
 * l'OT passe en attente de pièces. Le stock ne devient jamais négatif.
 */
export function splitPartRequest(quantity: number, stockAvailable: number): { issued: number; missing: number } {
  const issued = Math.min(quantity, Math.max(0, stockAvailable));
  return { issued, missing: quantity - issued };
}

export function describePartRequest(outcome: {
  issued: number;
  missing: number;
  /** Statut de la demande déjà en cours, réutilisée au lieu d'en créer une. */
  existingStatus?: string | null;
}): string {
  const { issued, missing, existingStatus } = outcome;
  const sortie = issued > 0 ? `${issued} sortie(s) du stock et ajoutée(s) à l'OT.` : "Stock épuisé.";
  if (missing === 0) return sortie;

  const demande = existingStatus
    ? `Une demande est déjà en cours pour cette pièce (${getPartRequirementStatusLabel(existingStatus)}).`
    : `Demande de pièce créée pour ${missing} unité(s) manquante(s).`;
  return `${sortie} ${demande} L'OT est en attente de pièces.`;
}
