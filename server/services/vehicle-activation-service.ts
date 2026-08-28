import { VehicleActivationService as WorkingVehicleActivationService } from "./vehicle-activation-service-working";

/**
 * Compatibility wrapper around the actively used implementation.
 * Keeps legacy imports compiling while delegating behavior.
 */
export class VehicleActivationService {
  static async activateVehicleFromWorkflow(
    workflowId: number,
    workflowData: Record<string, unknown>
  ): Promise<number> {
    const explicitVehicleId =
      typeof workflowData.vehicleId === "number" ? workflowData.vehicleId : undefined;
    const vehicleId = explicitVehicleId ?? workflowId;

    return WorkingVehicleActivationService.activateVehicleFromWorkflow(
      vehicleId,
      workflowData as any
    );
  }

  static async syncCompletedWorkflows(): Promise<{ synchronized: number; errors: string[] }> {
    // Kept as no-op for compatibility. The active flow is route-driven via working service.
    return { synchronized: 0, errors: [] };
  }
}
