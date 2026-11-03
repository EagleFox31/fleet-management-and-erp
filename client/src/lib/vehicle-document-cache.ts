import type { QueryClient } from "@tanstack/react-query";

/**
 * Resync (couche 3) après un dépôt ou une suppression de document véhicule.
 * Le serveur recopie la date d'échéance dans `vehicles.*` (miroir lu par
 * l'éligibilité mission) : il faut donc aussi rafraîchir le détail et les listes
 * véhicule (dont `/api/vehicles/all`, source de l'éligibilité dans la création de
 * mission) et les écrans satellites d'échéances et d'alertes.
 * Même ensemble de clés que le handler temps réel `vehicle_document_updated`.
 */
export function invalidateVehicleDocumentQueries(client: QueryClient, vehicleId: number | string): void {
  const keys: ReadonlyArray<readonly unknown[]> = [
    [`/api/vehicles/${vehicleId}/documents`],
    [`/api/vehicles/${vehicleId}`],
    ["/api/vehicles"],
    ["/api/vehicles/all"],
    ["/api/vehicles/all-with-status"],
    ["/api/vehicles/documents/all"],
    ["/api/vehicles/document-stats"],
    ["/api/vehicles/expiring-docs"],
    ["/api/vehicles/expired-docs"],
    ["/api/maintenance/date-alerts"],
    ["/api/alerts"],
    ["/api/alerts/count"],
    ["/api/alerts/active"],
    ["/api/alerts/unread"],
  ];
  for (const queryKey of keys) {
    void client.invalidateQueries({ queryKey: [...queryKey] });
  }
}
