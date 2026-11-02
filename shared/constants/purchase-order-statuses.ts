/**
 * Statuts d'une commande fournisseur : liste, libellés d'écran et transitions.
 * Source unique pour le serveur (`procurementService.updateOrderStatus`, route
 * `PATCH /api/purchase-orders/:id/status`) et l'écran de détail de commande.
 *
 * - Garder le même statut est toujours permis (no-op).
 * - Une commande clôturée ou annulée ne bouge plus.
 * - La clôture exige en plus des factures fournisseur toutes payées (contrôle serveur).
 */
export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "sent",
  "confirmed",
  "cancellation_requested",
  "partial",
  "delivered",
  "completed",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Readonly<Record<PurchaseOrderStatus, string>> = {
  draft: "À préparer",
  sent: "Transmise fournisseur",
  confirmed: "Confirmée fournisseur",
  cancellation_requested: "Annulation demandée",
  partial: "Réception partielle",
  delivered: "Réception complète",
  completed: "Clôturée",
  cancelled: "Annulée",
};

export const PURCHASE_ORDER_TRANSITIONS: Readonly<Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>> = {
  draft: ["sent", "cancelled"],
  sent: ["confirmed", "cancelled"],
  confirmed: ["partial", "delivered", "cancellation_requested"],
  partial: ["delivered", "cancellation_requested"],
  cancellation_requested: ["cancelled", "confirmed", "partial"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

export function getPurchaseOrderStatusLabel(status: string): string {
  return PURCHASE_ORDER_STATUS_LABELS[status as PurchaseOrderStatus] ?? status;
}

export function canTransitionPurchaseOrder(from: string, to: string): boolean {
  if (from === to) return true;
  return (PURCHASE_ORDER_TRANSITIONS[from as PurchaseOrderStatus] ?? []).includes(to as PurchaseOrderStatus);
}
