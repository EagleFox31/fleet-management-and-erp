import { storage } from "../storage";
import { AppError } from "./app-error";
import { canAccessOwned, type ScopeReader } from "./client-scope";

/**
 * Cloison client sur la lecture d'un ordre de travail (AGENTS.md §11).
 *
 * Applique la cloison client uniquement : l'OT doit exister, puis un client
 * n'accède qu'aux OT d'un véhicule dont il est propriétaire (`vehicles.ownerId`).
 * Le personnel n'est pas filtré ; un véhicule sans propriétaire n'est lisible que par lui.
 *
 * Un OT hors périmètre répond comme un OT inexistant (même statut 404, même message) :
 * un 403 distinct laisserait un client énumérer les OT des autres. Écart assumé avec le 403
 * de `canAccessOwned` utilisé pour les véhicules et documents.
 *
 * Écart connu : GET /api/work-orders/:id bloque aussi un technicien sur l'OT
 * d'un autre technicien (routes.ts, route GET /api/work-orders/:id). Ce helper ne le fait pas.
 */
export const MAX_DB_INTEGER_ID = 2147483647;

/** Un id de colonne `integer` : entier strictement positif tenant sur 32 bits (sinon Postgres répond 500). */
export function assertValidDbId(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DB_INTEGER_ID) {
    throw new AppError(400, message);
  }
}

const WORK_ORDER_NOT_FOUND_MESSAGE = "Ordre de travail non trouvé.";

export async function assertWorkOrderReadable(reader: ScopeReader | undefined, workOrderId: number): Promise<void> {
  assertValidDbId(workOrderId, "ID d'ordre de travail invalide.");
  const workOrder = await storage.getWorkOrder(workOrderId);
  if (!workOrder) {
    throw new AppError(404, WORK_ORDER_NOT_FOUND_MESSAGE);
  }
  const allowed = await canAccessOwned(reader, async () => (await storage.getVehicle(workOrder.vehicleId))?.ownerId);
  if (!allowed) {
    throw new AppError(404, WORK_ORDER_NOT_FOUND_MESSAGE);
  }
}
