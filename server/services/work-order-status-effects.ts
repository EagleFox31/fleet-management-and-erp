import { vehicleStatusService } from "./vehicle-status-service";

/**
 * Effets d'un changement de statut d'OT sur le reste du parc. Partagés par la modification
 * générique (`storage.updateWorkOrder`) et la transition dédiée (`transitionWorkOrderStatus`) :
 * une transition qui passe par l'une ou l'autre produit les mêmes effets.
 *
 * - `in_progress` : le véhicule passe en maintenance.
 * - `completed` : le véhicule repasse en service et l'échéance du plan préventif avance (P3-1).
 */
export async function applyWorkOrderStatusEffects(
  workOrder: { id: number; vehicleId: number | null; status: string },
  previousStatus: string,
): Promise<void> {
  if (workOrder.status === previousStatus) return;
  if (workOrder.status === "completed" && workOrder.vehicleId) {
    await vehicleStatusService.setVehicleToOperational(workOrder.vehicleId, workOrder.id);
  } else if (workOrder.status === "in_progress" && workOrder.vehicleId) {
    await vehicleStatusService.setVehicleToMaintenance(workOrder.vehicleId, workOrder.id);
  }
  if (workOrder.status === "completed") {
    const { preventiveMaintenanceService } = await import("./preventive-maintenance-service");
    await preventiveMaintenanceService.onWorkOrderCompleted(workOrder.id);
  }
}
