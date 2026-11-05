import type { QueryClient } from "@tanstack/react-query";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";

/**
 * Resync (couche 3) après le retrait d'un véhicule ou sa remise dans la flotte : mêmes clés que
 * le handler temps réel (catalogue `invalidates` + groupes satellites de l'événement).
 */
export function invalidateVehicleLifecycleQueries(
  client: QueryClient,
  event: "vehicle_deleted" | "vehicle_restored",
  vehicleId: number | string | null | undefined,
): void {
  for (const key of REALTIME_EVENTS[event].invalidates) void client.invalidateQueries({ queryKey: [key] });
  if (vehicleId != null) void client.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}`] });
  const { keys, prefixes } = satelliteTargetsOf(event, { vehicleId });
  for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  if (prefixes.length > 0) {
    void client.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && prefixes.some((prefix) => first.startsWith(prefix));
      },
    });
  }
}
