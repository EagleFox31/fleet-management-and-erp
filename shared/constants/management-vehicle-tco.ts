/** TCO véhicule Direction — formules pures (Phase 6). */

export type ManagementVehicleTcoItem = {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  acquisitionHT: number;
  periodFuelHT: number;
  periodMaintenanceHT: number;
  periodCostsHT: number;
  revenueHT: number;
  periodMarginHT: number;
  missionCount: number;
};

export type ManagementVehicleTco = {
  summary: {
    vehicleCount: number;
    fleetInsuranceHT: number;
    totalRevenueHT: number;
    totalPeriodCostsHT: number;
    totalPeriodMarginHT: number;
    missionsWithoutRevenueAttribution: number;
  };
  topByMargin: ManagementVehicleTcoItem[];
  worstByMargin: ManagementVehicleTcoItem[];
};

export function computeVehiclePeriodCostsHT(fuelHT: number, maintenanceHT: number): number {
  return fuelHT + maintenanceHT;
}

export function computeVehiclePeriodMarginHT(revenueHT: number, periodCostsHT: number): number {
  return revenueHT - periodCostsHT;
}

export function buildManagementVehicleTcoItem(input: {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  acquisitionHT: number;
  periodFuelHT: number;
  periodMaintenanceHT: number;
  revenueHT: number;
  missionCount: number;
}): ManagementVehicleTcoItem {
  const periodCostsHT = computeVehiclePeriodCostsHT(
    input.periodFuelHT,
    input.periodMaintenanceHT,
  );

  return {
    vehicleId: input.vehicleId,
    registrationNumber: input.registrationNumber,
    brand: input.brand,
    model: input.model,
    acquisitionHT: input.acquisitionHT,
    periodFuelHT: input.periodFuelHT,
    periodMaintenanceHT: input.periodMaintenanceHT,
    periodCostsHT,
    revenueHT: input.revenueHT,
    periodMarginHT: computeVehiclePeriodMarginHT(input.revenueHT, periodCostsHT),
    missionCount: input.missionCount,
  };
}

export function buildManagementVehicleTco(
  items: ManagementVehicleTcoItem[],
  options: { fleetInsuranceHT?: number; missionsWithoutRevenueAttribution?: number } = {},
): ManagementVehicleTco {
  const withActivity = items.filter(
    (item) => item.periodCostsHT > 0 || item.revenueHT > 0 || item.acquisitionHT > 0,
  );

  const totalRevenueHT = withActivity.reduce((sum, item) => sum + item.revenueHT, 0);
  const totalPeriodCostsHT = withActivity.reduce((sum, item) => sum + item.periodCostsHT, 0);
  const totalPeriodMarginHT = withActivity.reduce((sum, item) => sum + item.periodMarginHT, 0);

  const byMarginDesc = [...withActivity].sort((a, b) => b.periodMarginHT - a.periodMarginHT);
  const topByMargin = byMarginDesc.filter((item) => item.periodMarginHT > 0).slice(0, 5);
  const worstByMargin = [...withActivity]
    .filter((item) => item.periodMarginHT < 0)
    .sort((a, b) => a.periodMarginHT - b.periodMarginHT)
    .slice(0, 5);

  return {
    summary: {
      vehicleCount: withActivity.length,
      fleetInsuranceHT: options.fleetInsuranceHT ?? 0,
      totalRevenueHT,
      totalPeriodCostsHT,
      totalPeriodMarginHT,
      missionsWithoutRevenueAttribution: options.missionsWithoutRevenueAttribution ?? 0,
    },
    topByMargin,
    worstByMargin,
  };
}
