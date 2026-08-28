/** Libellé affiché tant qu'aucun montage atelier n'est enregistré (choix C — proposition 2). */
export const VEHICLE_TIRES_UNREGISTERED_LABEL = "Pneus non renseignés";

const isActiveMount = (row: Record<string, unknown>): boolean => {
  const nested = row.vehicle_tires ?? row.vehicleTires;
  const record = (nested ?? row) as Record<string, unknown>;
  const status = record.status;
  return status === undefined || status === "active";
};

export function countActiveMountedTires(records: unknown[] | undefined): number {
  if (!records?.length) return 0;
  return records.filter((row) => isActiveMount(row as Record<string, unknown>)).length;
}

export function vehicleHasRegisteredTires(records: unknown[] | undefined): boolean {
  return countActiveMountedTires(records) > 0;
}

export function vehicleIdsWithRegisteredTires(records: unknown[] | undefined): Set<number> {
  const ids = new Set<number>();
  for (const row of records ?? []) {
    const record = row as Record<string, unknown>;
    const nested = record.vehicle_tires ?? record.vehicleTires;
    const mount = (nested ?? record) as Record<string, unknown>;
    if (!isActiveMount(record)) continue;
    const vehicleId = Number(record.vehicleId ?? mount.vehicleId ?? mount.vehicle_id);
    if (Number.isInteger(vehicleId) && vehicleId > 0) {
      ids.add(vehicleId);
    }
  }
  return ids;
}
