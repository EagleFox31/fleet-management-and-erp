/** Rentabilité unitaire mission — formules pures Direction (Phase 6). */

export type ManagementMissionProfitabilityItem = {
  missionId: number;
  orderNumber: string;
  clientName: string;
  destination: string;
  revenueHT: number;
  fuelHT: number;
  roadExpensesHT: number | null;
  maintenanceShareHT: number;
  totalCostsHT: number;
  marginHT: number;
  marginPercent: number | null;
  hasIncompleteCosts: boolean;
  missingFields: string[];
};

export type ManagementMissionProfitability = {
  summary: {
    analyzedCount: number;
    profitableCount: number;
    deficitCount: number;
    incompleteDataCount: number;
    totalMarginHT: number;
  };
  topProfitable: ManagementMissionProfitabilityItem[];
  worstDeficit: ManagementMissionProfitabilityItem[];
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseAmount(value: unknown): number {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractMissionActualRoadExpensesHT(workflowData: unknown): number | null {
  const workflow = asPlainObject(workflowData);
  if (!workflow) {
    return null;
  }

  const execution = asPlainObject(workflow.execution);
  const costs =
    asPlainObject(workflow.costs) ??
    asPlainObject(workflow.actualCosts) ??
    asPlainObject(execution?.costs);

  const candidates = [
    costs?.actualFdrCost,
    costs?.actualRoadExpenses,
    costs?.roadExpensesActual,
    execution?.actualFdrCost,
    execution?.actualRoadExpenses,
    workflow.actualFdrCost,
    workflow.actualRoadExpenses,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") {
      continue;
    }
    const amount = parseAmount(candidate);
    if (Number.isFinite(amount) && amount >= 0) {
      return amount;
    }
  }

  return null;
}

/** Somme des FDR réels saisis sur les missions de la période (workflow, pas budget). */
export function sumMissionActualRoadExpensesHT(
  missions: Array<{ workflowData: unknown }>,
): { totalHT: number; missionCount: number; missingCount: number } {
  let totalHT = 0;
  let missionCount = 0;
  let missingCount = 0;

  for (const mission of missions) {
    const amount = extractMissionActualRoadExpensesHT(mission.workflowData);
    if (amount === null) {
      missingCount += 1;
      continue;
    }
    totalHT += amount;
    missionCount += 1;
  }

  return { totalHT, missionCount, missingCount };
}

/**
 * Frais de route réels — champs post-mission dans `workflowData` (cf. ALGO_RECOMMANDATION_BUDGET_MISSION).
 * Ne pas confondre avec le budget FDR prévisionnel.
 */
export function mergeMissionActualFdrCost(
  workflowData: unknown,
  actualFdrCost: number,
  meta?: { recordedAt?: string; recordedBy?: number },
): Record<string, unknown> {
  const workflow = asPlainObject(workflowData) ?? {};
  const costs = asPlainObject(workflow.costs) ?? {};

  return {
    ...workflow,
    costs: {
      ...costs,
      actualFdrCost,
      actualFdrRecordedAt: meta?.recordedAt ?? new Date().toISOString(),
      ...(meta?.recordedBy != null ? { actualFdrRecordedBy: meta.recordedBy } : {}),
    },
  };
}

export function resolveMissionFuelCostHT(
  actualFuelCost: string | number | null | undefined,
  fuelRecordsTotal: number,
): number {
  const fromMission = parseAmount(actualFuelCost);
  if (fromMission > 0) {
    return fromMission;
  }
  return fuelRecordsTotal > 0 ? fuelRecordsTotal : 0;
}

/** Quote-part maintenance = CPK maintenance période × km réels mission. */
export function computeMissionMaintenanceShareHT(
  cpkMaintenanceFcfPerKm: number | null,
  actualDistanceKm: number | null | undefined,
): number {
  if (cpkMaintenanceFcfPerKm == null || cpkMaintenanceFcfPerKm <= 0) {
    return 0;
  }
  const km = actualDistanceKm ?? 0;
  if (km <= 0) {
    return 0;
  }
  return cpkMaintenanceFcfPerKm * km;
}

export function computeMissionMarginHT(
  revenueHT: number,
  fuelHT: number,
  roadExpensesHT: number,
  maintenanceShareHT: number,
): number {
  return revenueHT - fuelHT - roadExpensesHT - maintenanceShareHT;
}

export function computeMissionMarginPercent(
  marginHT: number,
  revenueHT: number,
): number | null {
  if (revenueHT <= 0) {
    return null;
  }
  return (marginHT / revenueHT) * 100;
}

export type MissionProfitabilityInput = {
  missionId: number;
  orderNumber: string;
  clientName: string;
  destination: string;
  workflowData: unknown;
  actualFuelCost: string | number | null | undefined;
  actualDistance: number | null | undefined;
  fuelRecordsTotal: number;
  revenueHT: number;
  cpkMaintenanceFcfPerKm: number | null;
};

export function buildMissionProfitabilityItem(
  input: MissionProfitabilityInput,
): ManagementMissionProfitabilityItem {
  const fuelHT = resolveMissionFuelCostHT(input.actualFuelCost, input.fuelRecordsTotal);
  const roadExpensesRaw = extractMissionActualRoadExpensesHT(input.workflowData);
  const roadExpensesHT = roadExpensesRaw ?? 0;
  const maintenanceShareHT = computeMissionMaintenanceShareHT(
    input.cpkMaintenanceFcfPerKm,
    input.actualDistance,
  );
  const totalCostsHT = fuelHT + roadExpensesHT + maintenanceShareHT;
  const marginHT = computeMissionMarginHT(
    input.revenueHT,
    fuelHT,
    roadExpensesHT,
    maintenanceShareHT,
  );

  const missingFields: string[] = [];
  if (input.revenueHT <= 0) {
    missingFields.push("revenue");
  }
  if (roadExpensesRaw == null) {
    missingFields.push("roadExpenses");
  }
  if ((input.actualDistance ?? 0) <= 0 && maintenanceShareHT === 0) {
    missingFields.push("actualDistance");
  }

  return {
    missionId: input.missionId,
    orderNumber: input.orderNumber,
    clientName: input.clientName,
    destination: input.destination,
    revenueHT: input.revenueHT,
    fuelHT,
    roadExpensesHT: roadExpensesRaw,
    maintenanceShareHT,
    totalCostsHT,
    marginHT,
    marginPercent: computeMissionMarginPercent(marginHT, input.revenueHT),
    hasIncompleteCosts: missingFields.length > 0,
    missingFields,
  };
}

export function buildManagementMissionProfitability(
  items: ManagementMissionProfitabilityItem[],
  limits = { top: 5, worst: 5 },
): ManagementMissionProfitability {
  const analyzed = items.filter(
    (item) => item.revenueHT > 0 || item.totalCostsHT > 0,
  );

  const profitableCount = analyzed.filter((item) => item.marginHT > 0).length;
  const deficitCount = analyzed.filter((item) => item.marginHT < 0).length;
  const incompleteDataCount = analyzed.filter((item) => item.hasIncompleteCosts).length;
  const totalMarginHT = analyzed.reduce((sum, item) => sum + item.marginHT, 0);

  const byMarginDesc = [...analyzed].sort((a, b) => b.marginHT - a.marginHT);
  const topProfitable = byMarginDesc.filter((item) => item.marginHT > 0).slice(0, limits.top);
  const worstDeficit = [...analyzed]
    .filter((item) => item.marginHT < 0)
    .sort((a, b) => a.marginHT - b.marginHT)
    .slice(0, limits.worst);

  return {
    summary: {
      analyzedCount: analyzed.length,
      profitableCount,
      deficitCount,
      incompleteDataCount,
      totalMarginHT,
    },
    topProfitable,
    worstDeficit,
  };
}
