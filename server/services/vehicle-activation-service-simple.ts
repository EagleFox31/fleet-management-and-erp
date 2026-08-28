import { VehicleActivationService } from "./vehicle-activation-service-working";

/**
 * Legacy simple facade kept for backward compatibility.
 */
export class SimpleVehicleActivationService {
  static async activateVehicleFromWorkflow(
    workflowData: Record<string, unknown>
  ): Promise<number> {
    const vehicleId =
      typeof workflowData.vehicleId === "number" ? workflowData.vehicleId : undefined;

    if (!vehicleId) {
      throw new Error("vehicleId requis pour activer le véhicule");
    }

    return VehicleActivationService.activateVehicleFromWorkflow(vehicleId, workflowData as any);
  }
}
