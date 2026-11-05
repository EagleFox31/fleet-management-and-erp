import { and, eq, isNull, type SQL } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { ownerScopeOf, type ScopeReader } from "./client-scope";

/**
 * Filtre SQL des listes rattachées au véhicule, pour un propriétaire imposé (`ownerScopeOf`) :
 * - `null` (personnel) : aucun filtre, véhicules retirés compris ;
 * - un client : ses véhicules, et plus ceux qu'on a retirés (`deleted_at`), comme le détail
 *   `GET /api/vehicles/:id` et les sous-ressources (`assertVehicleSubresourcesReadable`).
 * Les services qui reçoivent déjà `ownerScopeOf(req.user)` l'appellent directement ; la règle
 * personnel/client reste dans `client-scope.ts`.
 * Exception documentée (AGENTS.md §11) : les OT d'un véhicule retiré restent lisibles par leur client.
 */
export function ownedLiveVehicles(ownerId: number | null): SQL | undefined {
  return ownerId === null ? undefined : and(eq(vehicles.ownerId, ownerId), isNull(vehicles.deletedAt));
}

/** Même filtre, à partir du lecteur : 401 sans utilisateur (`ownerScopeOf`). */
export function clientVehicleScope(reader: ScopeReader | undefined): SQL | undefined {
  return ownedLiveVehicles(ownerScopeOf(reader));
}
