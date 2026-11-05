/**
 * Actions de statut d'une commande fournisseur selon le rôle (écran de détail).
 * Commande liée à des pièces d'atelier : le logisticien sort du flux (MATRICE_ROLES_GAP.md l.22).
 * Réception : admin et magasinier seulement, comme canRecordDelivery côté serveur.
 */
export const PARTS_ORDER_ACTION_ROLES = ["admin", "secretary", "warehouse"] as const;
export const NON_PARTS_ORDER_ACTION_ROLES = ["admin", "secretary", "warehouse", "logistics"] as const;
export const DELIVERY_ACTION_ROLES = ["admin", "warehouse"] as const;

export type OrderStatusAction = { status: string; label: string };

export function orderCommandRoles(isPartsLinkedOrder: boolean): readonly string[] {
  return isPartsLinkedOrder ? PARTS_ORDER_ACTION_ROLES : NON_PARTS_ORDER_ACTION_ROLES;
}

export function canManageOrder(role: string, isPartsLinkedOrder: boolean): boolean {
  return orderCommandRoles(isPartsLinkedOrder).includes(role);
}

export function canRecordOrderDelivery(role: string): boolean {
  return (DELIVERY_ACTION_ROLES as readonly string[]).includes(role);
}

export function orderStatusActions(input: {
  role: string;
  status: string;
  isPartsLinkedOrder: boolean;
  /** Statut de retour si le fournisseur refuse l'annulation (partial ou confirmed). */
  rollbackStatus?: "partial" | "confirmed";
}): OrderStatusAction[] {
  const { role, status, isPartsLinkedOrder, rollbackStatus = "confirmed" } = input;
  if (!canManageOrder(role, isPartsLinkedOrder)) return [];
  switch (status) {
    case "draft":
      return [{ status: "sent", label: "Envoyer au fournisseur" }];
    case "sent":
      return [{ status: "confirmed", label: "Confirmer la commande" }];
    case "confirmed":
    case "partial":
      return canRecordOrderDelivery(role) ? [{ status: "delivered", label: "Enregistrer la livraison" }] : [];
    case "cancellation_requested":
      return [
        { status: "cancelled", label: "Confirmer l'annulation fournisseur" },
        {
          status: rollbackStatus,
          label: rollbackStatus === "partial" ? "Refus fournisseur (retour réception partielle)" : "Refus fournisseur (retour confirmée)",
        },
      ];
    default:
      return [];
  }
}
