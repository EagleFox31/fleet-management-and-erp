/** Scorecard chauffeur Direction — formules pures (Phase 6). */

const CONSUMPTION_WEIGHT = 0.4;
const PUNCTUALITY_WEIGHT = 0.4;
const INCIDENT_WEIGHT = 0.2;

/** Tolérance livraison corridor (minutes) — retards inférieurs ne pénalisent pas. */
export const DRIVER_PUNCTUALITY_GRACE_MINUTES = 240;

/** Au-delà de ce ratio vs médiane flotte, score consommation = 0. */
export const DRIVER_CONSUMPTION_MAX_DEVIATION_RATIO = 1.3;

export type ManagementDriverScorecardItem = {
  driverId: number;
  driverName: string;
  missionCount: number;
  missionsWithConsumption: number;
  averageConsumptionL100: number | null;
  consumptionScore: number | null;
  punctualityRate: number | null;
  punctualityScore: number | null;
  onTimeMissionCount: number;
  punctualMissionCount: number;
  incidentCount: number;
  incidentScore: number;
  overallScore: number | null;
  incompleteData: boolean;
};

export type ManagementDriverScorecard = {
  summary: {
    driverCount: number;
    fleetMedianConsumptionL100: number | null;
    averageOverallScore: number | null;
    driversWithIncidents: number;
  };
  topPerformers: ManagementDriverScorecardItem[];
  needsAttention: ManagementDriverScorecardItem[];
  /** Chauffeurs avec activité sur la période, triés par note décroissante. */
  allScored: ManagementDriverScorecardItem[];
};

export type DriverMissionMetricsInput = {
  missionId: number;
  actualFuelQuantity: number | null;
  actualDistance: number | null;
  plannedDeliveryAt: Date | null;
  actualDeliveryAt: Date | null;
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Lit la livraison réelle depuis workflowData.execution.actualDeliveryDate. */
export function extractMissionActualDeliveryDate(
  workflowData: unknown,
  fallback?: Date | string | null,
): Date | null {
  const workflow = asPlainObject(workflowData);
  const execution = asPlainObject(workflow?.execution);
  return toDate(execution?.actualDeliveryDate) ?? toDate(fallback);
}

export function computeMissionConsumptionL100(
  actualFuelQuantity: number | null,
  actualDistance: number | null,
): number | null {
  if (
    actualFuelQuantity == null ||
    actualDistance == null ||
    actualFuelQuantity <= 0 ||
    actualDistance <= 0
  ) {
    return null;
  }
  return (actualFuelQuantity / actualDistance) * 100;
}

export function computeFleetMedianConsumptionL100(values: number[]): number | null {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (positive.length === 0) return null;

  const mid = Math.floor(positive.length / 2);
  if (positive.length % 2 === 0) {
    return (positive[mid - 1] + positive[mid]) / 2;
  }
  return positive[mid];
}

export function computeConsumptionScore(
  driverAverageL100: number,
  fleetMedianL100: number,
): number {
  if (fleetMedianL100 <= 0) return 50;

  const ratio = driverAverageL100 / fleetMedianL100;
  if (ratio <= 1) return 100;

  const excess = ratio - 1;
  const maxExcess = DRIVER_CONSUMPTION_MAX_DEVIATION_RATIO - 1;
  const score = 100 - (excess / maxExcess) * 100;
  return Math.max(0, Math.min(100, score));
}

export function isMissionDeliveryOnTime(
  plannedDeliveryAt: Date,
  actualDeliveryAt: Date,
  graceMinutes = DRIVER_PUNCTUALITY_GRACE_MINUTES,
): boolean {
  const graceMs = graceMinutes * 60 * 1000;
  return actualDeliveryAt.getTime() <= plannedDeliveryAt.getTime() + graceMs;
}

export function computePunctualityScore(onTimeCount: number, eligibleCount: number): number | null {
  if (eligibleCount <= 0) return null;
  return (onTimeCount / eligibleCount) * 100;
}

export function computeIncidentScore(incidentCount: number): number {
  return Math.max(0, 100 - incidentCount * 25);
}

export function computeDriverOverallScore(
  consumptionScore: number | null,
  punctualityScore: number | null,
  incidentScore: number,
): number | null {
  const weighted: Array<{ score: number; weight: number }> = [];

  if (consumptionScore != null) {
    weighted.push({ score: consumptionScore, weight: CONSUMPTION_WEIGHT });
  }
  if (punctualityScore != null) {
    weighted.push({ score: punctualityScore, weight: PUNCTUALITY_WEIGHT });
  }
  weighted.push({ score: incidentScore, weight: INCIDENT_WEIGHT });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  return weighted.reduce((sum, item) => sum + item.score * (item.weight / totalWeight), 0);
}

export function aggregateDriverMissionMetrics(
  missions: DriverMissionMetricsInput[],
): {
  missionCount: number;
  missionsWithConsumption: number;
  averageConsumptionL100: number | null;
  punctualityRate: number | null;
  onTimeMissionCount: number;
  punctualMissionCount: number;
} {
  let consumptionSum = 0;
  let consumptionCount = 0;
  let onTimeCount = 0;
  let punctualEligible = 0;

  for (const mission of missions) {
    const consumption = computeMissionConsumptionL100(
      mission.actualFuelQuantity,
      mission.actualDistance,
    );
    if (consumption != null) {
      consumptionSum += consumption;
      consumptionCount += 1;
    }

    if (mission.plannedDeliveryAt && mission.actualDeliveryAt) {
      punctualEligible += 1;
      if (isMissionDeliveryOnTime(mission.plannedDeliveryAt, mission.actualDeliveryAt)) {
        onTimeCount += 1;
      }
    }
  }

  return {
    missionCount: missions.length,
    missionsWithConsumption: consumptionCount,
    averageConsumptionL100:
      consumptionCount > 0 ? consumptionSum / consumptionCount : null,
    punctualityRate:
      punctualEligible > 0 ? onTimeCount / punctualEligible : null,
    onTimeMissionCount: onTimeCount,
    punctualMissionCount: punctualEligible,
  };
}

export function buildManagementDriverScorecardItem(input: {
  driverId: number;
  driverName: string;
  missions: DriverMissionMetricsInput[];
  incidentCount: number;
  fleetMedianConsumptionL100: number | null;
}): ManagementDriverScorecardItem {
  const metrics = aggregateDriverMissionMetrics(input.missions);

  const consumptionScore =
    metrics.averageConsumptionL100 != null && input.fleetMedianConsumptionL100 != null
      ? computeConsumptionScore(metrics.averageConsumptionL100, input.fleetMedianConsumptionL100)
      : null;

  const punctualityScore = computePunctualityScore(
    metrics.onTimeMissionCount,
    metrics.punctualMissionCount,
  );

  const incidentScore = computeIncidentScore(input.incidentCount);

  const overallScore = computeDriverOverallScore(
    consumptionScore,
    punctualityScore,
    incidentScore,
  );

  const incompleteData =
    metrics.missionCount > 0 &&
    metrics.missionsWithConsumption === 0 &&
    metrics.punctualMissionCount === 0;

  return {
    driverId: input.driverId,
    driverName: input.driverName,
    missionCount: metrics.missionCount,
    missionsWithConsumption: metrics.missionsWithConsumption,
    averageConsumptionL100: metrics.averageConsumptionL100,
    consumptionScore,
    punctualityRate: metrics.punctualityRate,
    punctualityScore,
    onTimeMissionCount: metrics.onTimeMissionCount,
    punctualMissionCount: metrics.punctualMissionCount,
    incidentCount: input.incidentCount,
    incidentScore,
    overallScore,
    incompleteData,
  };
}

/** Extrait le numéro de commande depuis « [Mission CMD-123] … ». */
export function parseMissionOrderNumberFromAlertMessage(message: string): string | null {
  const match = message.match(/\[Mission\s+([^\]]+)\]/i);
  return match?.[1]?.trim() ?? null;
}

export function buildManagementDriverScorecard(
  items: ManagementDriverScorecardItem[],
): ManagementDriverScorecard {
  const active = items.filter((item) => item.missionCount > 0);

  const consumptionValues = active
    .map((item) => item.averageConsumptionL100)
    .filter((value): value is number => value != null && value > 0);

  const scored = active.filter((item) => item.overallScore != null);
  const averageOverallScore =
    scored.length > 0
      ? scored.reduce((sum, item) => sum + (item.overallScore ?? 0), 0) / scored.length
      : null;

  const byScoreDesc = [...active]
    .filter((item) => item.overallScore != null)
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));

  const topPerformers = byScoreDesc.slice(0, 5);
  const needsAttention = [...active]
    .filter(
      (item) =>
        (item.overallScore != null && item.overallScore < 60) ||
        item.incidentCount > 0 ||
        item.incompleteData,
    )
    .sort((a, b) => (a.overallScore ?? 0) - (b.overallScore ?? 0))
    .slice(0, 5);

  return {
    summary: {
      driverCount: active.length,
      fleetMedianConsumptionL100: computeFleetMedianConsumptionL100(consumptionValues),
      averageOverallScore,
      driversWithIncidents: active.filter((item) => item.incidentCount > 0).length,
    },
    topPerformers,
    needsAttention,
    allScored: byScoreDesc,
  };
}
