/**
 * Calcul de consommation véhicule par méthode plein à plein (tank-to-tank).
 *
 * Le premier plein sert de repère kilométrique : son carburant n'entre pas
 * dans le numérateur. Chaque plein suivant i apporte la quantité consommée
 * sur l'intervalle [plein i-1 → plein i].
 *
 * @see docs/plans/fuel-consumption-performance.md
 * @see docs/walkthroughs/fuel-page-corrections/WALKTHROUGH.md
 */

export interface FuelRecordForConsumption {
  vehicleId: number | null;
  date: string | Date | null;
  quantity: number | null;
  mileage: number | null;
}

export interface VehicleFuelStats {
  totalFuel: number;
  totalDistance: number;
  averageConsumption: number | null;
  recordCount: number;
  validIntervalCount: number;
  unavailableReason: string | null;
}

export interface VehicleConsumptionRow extends VehicleFuelStats {
  vehicleId: number;
  registrationNumber?: string;
  brand?: string;
  model?: string;
  lastMileage: number | null;
}

function recordTimestamp(date: string | Date | null): number {
  if (!date) return 0;
  return new Date(date).getTime();
}

function hasMileage(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/**
 * Statistiques de consommation pour les pleins d'un seul véhicule, triés ou non.
 */
export function computeVehicleFuelStats(
  records: FuelRecordForConsumption[],
): VehicleFuelStats {
  const sorted = [...records].sort(
    (a, b) => recordTimestamp(a.date) - recordTimestamp(b.date),
  );
  const recordCount = sorted.length;

  if (recordCount < 2) {
    return {
      totalFuel: 0,
      totalDistance: 0,
      averageConsumption: null,
      recordCount,
      validIntervalCount: 0,
      unavailableReason: "Un seul plein enregistré, il en faut deux",
    };
  }

  let totalFuel = 0;
  let totalDistance = 0;
  let validIntervalCount = 0;
  let hasMissingMileage = false;

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];

    if (!hasMileage(previous.mileage) || !hasMileage(current.mileage)) {
      hasMissingMileage = true;
      continue;
    }

    const distance = current.mileage - previous.mileage;
    if (distance <= 0) continue;

    totalFuel += Number(current.quantity || 0);
    totalDistance += distance;
    validIntervalCount++;
  }

  let unavailableReason: string | null = null;
  if (validIntervalCount === 0) {
    unavailableReason = hasMissingMileage
      ? "Kilométrage non renseigné sur les pleins"
      : "Distance parcourue non calculable entre les pleins";
  }

  const averageConsumption =
    totalDistance > 0 ? (totalFuel / totalDistance) * 100 : null;

  return {
    totalFuel,
    totalDistance,
    averageConsumption,
    recordCount,
    validIntervalCount,
    unavailableReason,
  };
}

export interface VehicleMeta {
  registrationNumber?: string;
  brand?: string;
  model?: string;
}

/**
 * Agrège la consommation par véhicule à partir d'une liste hétérogène de pleins.
 * Complexité O(n log n) par véhicule (tri), sans re-parcours O(n²).
 */
export function computeVehicleConsumptionRows(
  records: FuelRecordForConsumption[],
  vehicleMeta: Record<number, VehicleMeta> = {},
): VehicleConsumptionRow[] {
  const byVehicle = new Map<number, FuelRecordForConsumption[]>();

  for (const record of records) {
    if (!record.vehicleId) continue;
    const bucket = byVehicle.get(record.vehicleId) ?? [];
    bucket.push(record);
    byVehicle.set(record.vehicleId, bucket);
  }

  const rows: VehicleConsumptionRow[] = [];

  for (const [vehicleId, vehicleRecords] of byVehicle.entries()) {
    const sorted = [...vehicleRecords].sort(
      (a, b) => recordTimestamp(a.date) - recordTimestamp(b.date),
    );
    const stats = computeVehicleFuelStats(sorted);
    const lastRecord = sorted[sorted.length - 1];

    rows.push({
      vehicleId,
      registrationNumber: vehicleMeta[vehicleId]?.registrationNumber,
      brand: vehicleMeta[vehicleId]?.brand,
      model: vehicleMeta[vehicleId]?.model,
      lastMileage: lastRecord?.mileage ?? null,
      ...stats,
    });
  }

  return rows.sort((a, b) =>
    (a.registrationNumber || "").localeCompare(b.registrationNumber || "", "fr"),
  );
}

export function formatConsumptionDisplay(
  stats: Pick<VehicleFuelStats, "averageConsumption" | "unavailableReason">,
): { value: string; detail?: string } {
  if (stats.averageConsumption != null && stats.averageConsumption > 0) {
    return {
      value: `${stats.averageConsumption.toFixed(2).replace(".", ",")} L/100 km`,
    };
  }

  return {
    value: "Non calculable",
    detail: stats.unavailableReason ?? undefined,
  };
}
