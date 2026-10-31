/**
 * Véhicules proposés à la déclaration de panne (`/driver/incident`).
 *
 * - Chauffeur : ses véhicules, lus dans ses missions (`GET /api/drivers/me`), mission
 *   active d'abord. `GET /api/vehicles` renvoie toute la flotte au personnel : un
 *   chauffeur ne doit pas déclarer une panne sur un véhicule qu'il ne conduit pas.
 * - Administrateur : la flotte (`GET /api/vehicles`, réponse `{ vehicles: [...] }`).
 */
export type IncidentVehicleOption = { id: number; label: string };

type DriverMission = {
  status?: string;
  vehicleId?: number | null;
  vehicleRegistration?: string | null;
};

type FleetVehicle = { id: number; registrationNumber?: string | null; registration?: string | null };

const ACTIVE_MISSION = new Set(["in_progress", "assigned"]);

export function driverVehicleOptions(me: { missions?: DriverMission[] } | null | undefined): IncidentVehicleOption[] {
  const missions = [...(me?.missions ?? [])].sort(
    (a, b) => Number(ACTIVE_MISSION.has(b.status ?? "")) - Number(ACTIVE_MISSION.has(a.status ?? "")),
  );
  const seen = new Map<number, IncidentVehicleOption>();
  for (const m of missions) {
    if (m.vehicleId == null || seen.has(m.vehicleId)) continue;
    seen.set(m.vehicleId, { id: m.vehicleId, label: m.vehicleRegistration || `Véhicule ${m.vehicleId}` });
  }
  return [...seen.values()];
}

/** Accepte la réponse paginée `{ vehicles }` comme un tableau nu. */
export function fleetVehicleOptions(data: unknown): IncidentVehicleOption[] {
  const list: unknown = Array.isArray(data) ? data : (data as { vehicles?: unknown } | null)?.vehicles;
  if (!Array.isArray(list)) return [];
  return (list as FleetVehicle[])
    .filter((v) => typeof v?.id === "number")
    .map((v) => ({ id: v.id, label: v.registrationNumber || v.registration || `Véhicule ${v.id}` }));
}
