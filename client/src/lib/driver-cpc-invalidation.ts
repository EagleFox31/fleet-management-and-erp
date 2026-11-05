import type { QueryClient } from "@tanstack/react-query";

/**
 * Écrans qui dépendent du statut ou de la date CPC d'un chauffeur : fiches, listes, statistiques,
 * missions (liste, détail, check-list de lancement) où l'éligibilité est calculée par le serveur.
 * Couche 3 de AGENTS.md §2, partagée par les mutations et par la synchro temps réel.
 */
export function invalidateDriverCpcDependents(client: QueryClient, driverId?: number | string | null): void {
  if (driverId !== undefined && driverId !== null && driverId !== "") {
    client.invalidateQueries({ queryKey: [`/api/drivers/${driverId}`] });
  }
  for (const key of [
    "/api/drivers",
    "/api/drivers/cpc-statistics",
    "/api/drivers/cpc-status",
    "/api/drivers/expiring-cpc",
    "/api/missions",
  ]) {
    client.invalidateQueries({ queryKey: [key] });
  }
  client.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey?.[0];
      return typeof first === "string" && /^\/api\/missions\/\d+(\/launch-readiness)?$/.test(first);
    },
  });
}
