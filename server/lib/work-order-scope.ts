import { storage } from "../storage";
import { AppError } from "./app-error";
import { canAccessOwned, OUT_OF_SCOPE_MESSAGE, type ScopeReader } from "./client-scope";

/**
 * Cloison client sur la lecture d'un ordre de travail (AGENTS.md §11).
 *
 * Même règle que GET /api/work-orders/:id : l'OT doit exister (404), puis un
 * client n'accède qu'aux OT d'un véhicule dont il est propriétaire
 * (`vehicles.ownerId`). Le personnel n'est pas filtré ; un véhicule sans
 * propriétaire n'est lisible que par lui.
 */
export async function assertWorkOrderReadable(reader: ScopeReader | undefined, workOrderId: number): Promise<void> {
  const workOrder = await storage.getWorkOrder(workOrderId);
  if (!workOrder) {
    throw new AppError(404, "Ordre de travail non trouvé.");
  }
  const allowed = await canAccessOwned(reader, async () => (await storage.getVehicle(workOrder.vehicleId))?.ownerId);
  if (!allowed) {
    throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
  }
}
