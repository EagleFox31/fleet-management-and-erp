/**
 * Véhicules proposés à la déclaration de panne (`/driver/incident`).
 *
 * - Chauffeur : les véhicules de ses affectations **actives**, lus dans ses missions
 *   (`GET /api/drivers/me`, champ `assignmentStatus`), mission en cours d'abord. Le
 *   serveur refuse une panne hors de ces affectations (`ACTIVE_ASSIGNMENT_STATUSES`,
 *   même liste) : proposer le véhicule d'une mission terminée menait à un 403.
 *   `GET /api/vehicles` renvoie toute la flotte au personnel : un chauffeur ne doit
 *   pas déclarer une panne sur un véhicule qu'il ne conduit pas.
 * - Administrateur : la flotte (`GET /api/vehicles`, réponse `{ vehicles: [...] }`).
 */
import { isActiveAssignmentStatus } from "@shared/constants/assignments";

export type IncidentVehicleOption = { id: number; label: string };

type DriverMission = {
  status?: string;
  assignmentStatus?: string | null;
  vehicleId?: number | null;
  vehicleRegistration?: string | null;
};

type FleetVehicle = { id: number; registrationNumber?: string | null; registration?: string | null };

/** Ordre d'affichage : mission en cours, puis assignée, puis le reste. */
const MISSION_RANK: Record<string, number> = { in_progress: 0, assigned: 1 };
const rank = (m: DriverMission) => MISSION_RANK[m.status ?? ""] ?? 2;

export function driverVehicleOptions(me: { missions?: DriverMission[] } | null | undefined): IncidentVehicleOption[] {
  const missions = (me?.missions ?? [])
    .filter((m) => isActiveAssignmentStatus(m.assignmentStatus))
    .sort((a, b) => rank(a) - rank(b));
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
