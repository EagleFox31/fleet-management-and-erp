/**
 * Source unique des libellés client pour les statuts de demande de pièce.
 *
 * Convention: le badge décrit LA DEMANDE, pas la pièce.
 * Les mouvements de stock sont nommés par paire symétrique
 * ("Entrée en stock" / "Sortie du stock") pour rester lisibles par le magasin.
 *
 * Ne pas redéclarer ces libellés ailleurs: le serveur et les pages importent d'ici.
 */
export const PART_REQUIREMENT_STATUS_LABELS = {
  pending: "En attente",
  approved: "Approuvée",
  rejected: "Rejetée",
  ordered: "Commandée",
  partially_received: "Livraison incomplète",
  received: "Entrée en stock",
  issued: "Sortie du stock",
  fulfilled: "Utilisée",
  cancel_requested: "Annulation demandée",
  cancelled: "Annulée",
  // Statuts historiques conservés pour rétrocompatibilité des anciennes demandes.
  partial: "Livraison incomplète",
  delivered: "Livrée",
} as const;

export type PartRequirementStatusKey = keyof typeof PART_REQUIREMENT_STATUS_LABELS;

export function getPartRequirementStatusLabel(status: string): string {
  return (
    PART_REQUIREMENT_STATUS_LABELS[status as PartRequirementStatusKey] ?? status
  );
}

/**
 * Avancement de la demande, écrit pour celui qui attend la pièce.
 *
 * Le badge de statut dit *où on en est* ("Commandée"); ceci dit *ce qu'on
 * attend et de qui* ("Commandée — en attente de livraison"). Un technicien
 * immobilisé n'a pas besoin du nom de l'étape, il a besoin de savoir qui
 * relancer.
 *
 * `requesterRole` sert au seul cas ambigu: quand c'est le chef d'atelier qui a
 * créé la demande, il ne peut pas s'auto-approuver — c'est la secrétaire qui
 * tranche (règle de séparation des tâches déjà appliquée par le workflow).
 */
export function getPartRequirementProgressLabel(
  status: string,
  requesterRole?: string | null,
): string {
  switch (status) {
    case "pending":
      return requesterRole === "workshop_manager"
        ? "En attente de validation par la secrétaire"
        : "En attente de validation par le chef d'atelier";
    case "approved":
      return "Besoin validé — en attente de commande";
    case "ordered":
      return "Commandée — en attente de livraison";
    case "partially_received":
    case "partial":
      return "Livraison incomplète — en attente du reste";
    case "delivered":
      return "Livrée — en attente de réception au magasin";
    case "received":
      return "Prête au magasin";
    case "cancel_requested":
      return "Annulation demandée — en attente de décision";
    default:
      return getPartRequirementStatusLabel(status);
  }
}
