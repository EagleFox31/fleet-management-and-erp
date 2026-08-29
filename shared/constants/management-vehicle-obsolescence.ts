/** Indice vétusté véhicule Direction — formules pures (Phase 6). */

/** Durée d'amortissement linéaire de référence (années). */
export const VEHICLE_USEFUL_LIFE_YEARS = 10;

export type ManagementVehicleObsolescenceItem = {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  acquisitionHT: number;
  ageYears: number;
  residualValueHT: number;
  periodMaintenanceHT: number;
  annualizedMaintenanceHT: number;
  maintenanceToResidualRatio: number | null;
  recommendReplacement: boolean;
};

export type ManagementVehicleObsolescence = {
  summary: {
    vehicleCount: number;
    replacementCandidates: number;
    totalAnnualizedMaintenanceHT: number;
  };
  candidates: ManagementVehicleObsolescenceItem[];
};

export function computeVehicleAgeYears(
  purchaseDate: Date | null,
  referenceDate: Date,
): number {
  if (!purchaseDate) return 0;
  const ageMs = referenceDate.getTime() - purchaseDate.getTime();
  if (ageMs <= 0) return 0;
  return ageMs / (365.25 * 24 * 60 * 60 * 1000);
}

export function computeLinearResidualValueHT(
  acquisitionHT: number,
  ageYears: number,
  usefulLifeYears = VEHICLE_USEFUL_LIFE_YEARS,
): number {
  if (acquisitionHT <= 0) return 0;
  const depreciationRatio = Math.min(1, Math.max(0, ageYears / usefulLifeYears));
  return acquisitionHT * (1 - depreciationRatio);
}

export function annualizePeriodAmount(amountHT: number, periodDays: number): number {
  if (periodDays <= 0 || amountHT <= 0) return 0;
  return amountHT * (365 / periodDays);
}

export function computeMaintenanceToResidualRatio(
  annualizedMaintenanceHT: number,
  residualValueHT: number,
): number | null {
  if (annualizedMaintenanceHT <= 0) return null;
  if (residualValueHT <= 0) return null;
  return annualizedMaintenanceHT / residualValueHT;
}

export function shouldRecommendVehicleReplacement(input: {
  acquisitionHT: number;
  annualizedMaintenanceHT: number;
  residualValueHT: number;
}): boolean {
  if (input.acquisitionHT <= 0 || input.annualizedMaintenanceHT <= 0) {
    return false;
  }

  if (input.residualValueHT <= 0) {
    return true;
  }

  return input.annualizedMaintenanceHT > input.residualValueHT;
}

export function buildManagementVehicleObsolescenceItem(input: {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  acquisitionHT: number;
  purchaseDate: Date | null;
  periodMaintenanceHT: number;
  periodDays: number;
  referenceDate: Date;
}): ManagementVehicleObsolescenceItem {
  const ageYears = computeVehicleAgeYears(input.purchaseDate, input.referenceDate);
  const residualValueHT = computeLinearResidualValueHT(input.acquisitionHT, ageYears);
  const annualizedMaintenanceHT = annualizePeriodAmount(
    input.periodMaintenanceHT,
    input.periodDays,
  );
  const maintenanceToResidualRatio = computeMaintenanceToResidualRatio(
    annualizedMaintenanceHT,
    residualValueHT,
  );
  const recommendReplacement = shouldRecommendVehicleReplacement({
    acquisitionHT: input.acquisitionHT,
    annualizedMaintenanceHT,
    residualValueHT,
  });

  return {
    vehicleId: input.vehicleId,
    registrationNumber: input.registrationNumber,
    brand: input.brand,
    model: input.model,
    acquisitionHT: input.acquisitionHT,
    ageYears,
    residualValueHT,
    periodMaintenanceHT: input.periodMaintenanceHT,
    annualizedMaintenanceHT,
    maintenanceToResidualRatio,
    recommendReplacement,
  };
}

export function buildManagementVehicleObsolescence(
  items: ManagementVehicleObsolescenceItem[],
): ManagementVehicleObsolescence {
  const withAcquisition = items.filter((item) => item.acquisitionHT > 0);

  const candidates = withAcquisition
    .filter((item) => item.recommendReplacement)
    .sort((a, b) => {
      const ratioA = a.maintenanceToResidualRatio ?? Number.POSITIVE_INFINITY;
      const ratioB = b.maintenanceToResidualRatio ?? Number.POSITIVE_INFINITY;
      return ratioB - ratioA;
    })
    .slice(0, 8);

  return {
    summary: {
      vehicleCount: withAcquisition.length,
      replacementCandidates: candidates.length,
      totalAnnualizedMaintenanceHT: withAcquisition.reduce(
        (sum, item) => sum + item.annualizedMaintenanceHT,
        0,
      ),
    },
    candidates,
  };
}
