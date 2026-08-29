/** Vue équipe Direction — effectifs par pôle, productivité, conformité et décisions DG. */

import type { ManagementPeriod } from "./management-dashboard";
import type { ManagementDriverScorecard } from "./management-driver-scorecard";

export const MANAGEMENT_TEAM_POLES = {
  operations: {
    label: "Exploitation & Transport",
    caption: "Missions, planning, corridors",
    roles: ["logistics", "secretary", "driver"] as const,
  },
  workshop: {
    label: "Atelier & Maintenance",
    caption: "Réparations, révisions, OT",
    roles: ["workshop_manager", "technician"] as const,
  },
  warehouse: {
    label: "Magasin & Stocks",
    caption: "Gestion pièces et pneumatiques",
    roles: ["warehouse"] as const,
  },
} as const;

export type ManagementTeamPoleId = keyof typeof MANAGEMENT_TEAM_POLES;

export const APP_ROLE_LABELS: Record<string, string> = {
  logistics: "Logisticiens",
  secretary: "Secrétariat",
  driver: "Chauffeurs (app)",
  workshop_manager: "Chef d'atelier",
  technician: "Techniciens",
  warehouse: "Magasiniers",
};

export type ManagementTeamDecisionSeverity = "critical" | "warning" | "info";

export type ManagementTeamDecision = {
  id: string;
  severity: ManagementTeamDecisionSeverity;
  title: string;
  recommendation: string;
};

export type ManagementTeamPole = {
  id: ManagementTeamPoleId;
  label: string;
  caption: string;
  appAccountCount: number;
  roleBreakdown: Array<{ role: string; label: string; count: number }>;
};

export type WorkforceMobility = {
  onRoadCount: number;
  availableCount: number;
  onLeaveCount: number;
  mobilizationRate: number; // en %
};

export type PoleProductivity = {
  operations: {
    missionsTotal: number;
    totalKm: number;
    averageRevenuePerDriver: number;
  };
  workshop: {
    completedWorkOrders: number;
    averageDowntimeHours: number;
  };
  warehouse: {
    partsMovementCount: number;
  };
};

export type DriverBonusItem = {
  driverId: number;
  driverName: string;
  overallScore: number;
  averageConsumptionL100: number | null;
  missionCount: number;
};

export type DriverTrainingNeedItem = {
  driverId: number;
  driverName: string;
  overallScore: number;
  reason: string;
};

export type DriverRewards = {
  totalRoadExpenses: number;
  topPerformers: DriverBonusItem[];
  needsTraining: DriverTrainingNeedItem[];
};

export type ManagementTeamResponse = {
  period: ManagementPeriod;
  summary: {
    appAccounts: number;
    driversField: number;
    driversActive: number;
  };
  poles: ManagementTeamPole[];
  drivers: {
    cpcCompliant: number;
    cpcGap: number;
    cpcUrgent: number;
  };
  mobility: WorkforceMobility;
  productivity: PoleProductivity;
  rewards: DriverRewards;
  decisions: ManagementTeamDecision[];
};

export function buildManagementTeamPoles(
  roleCounts: Map<string, number>,
): ManagementTeamPole[] {
  return (Object.entries(MANAGEMENT_TEAM_POLES) as Array<
    [ManagementTeamPoleId, (typeof MANAGEMENT_TEAM_POLES)[ManagementTeamPoleId]]
  >).map(([id, pole]) => {
    const roleBreakdown = pole.roles
      .map((role) => ({
        role,
        label: APP_ROLE_LABELS[role] ?? role,
        count: roleCounts.get(role) ?? 0,
      }))
      .filter((entry) => entry.count > 0);

    return {
      id,
      label: pole.label,
      caption: pole.caption,
      appAccountCount: roleBreakdown.reduce((sum, entry) => sum + entry.count, 0),
      roleBreakdown,
    };
  });
}

export function buildManagementTeamDecisions(input: {
  cpcGap: number;
  cpcUrgent: number;
  driversWithIncidents: number;
  underperformingDrivers: number;
  vehiclesOutOfService: number;
  vehiclesImmobilizedOver48h: number;
}): ManagementTeamDecision[] {
  const decisions: ManagementTeamDecision[] = [];

  if (input.cpcGap > 0) {
    decisions.push({
      id: "cpc-gap",
      severity: input.cpcUrgent > 0 ? "critical" : "warning",
      title:
        input.cpcGap === 1
          ? "1 conducteur sans habilitation CPC / permis à jour"
          : `${input.cpcGap} conducteurs sans habilitation CPC / permis à jour`,
      recommendation: "Valider le plan de formation avec le secrétariat avant prochaine affectation.",
    });
  }

  if (input.driversWithIncidents > 0) {
    decisions.push({
      id: "driver-incidents",
      severity: "warning",
      title:
        input.driversWithIncidents === 1
          ? "1 signalement incident sur la période"
          : `${input.driversWithIncidents} signalements incident sur la période`,
      recommendation: "Demander un point exploitation : causes et mesures correctives.",
    });
  }

  if (input.underperformingDrivers > 0) {
    decisions.push({
      id: "driver-performance",
      severity: "info",
      title:
        input.underperformingDrivers === 1
          ? "1 conducteur sous la barre de performance éco-conduite"
          : `${input.underperformingDrivers} conducteurs sous la barre de performance éco-conduite`,
      recommendation: "Arbitrer un entretien manager (consommation, ponctualité) avec la logistique.",
    });
  }

  if (input.vehiclesOutOfService > 0) {
    decisions.push({
      id: "fleet-oos",
      severity: input.vehiclesOutOfService >= 3 ? "critical" : "warning",
      title:
        input.vehiclesOutOfService === 1
          ? "1 camion hors service"
          : `${input.vehiclesOutOfService} camions hors service`,
      recommendation: "Vérifier l'impact sur la capacité de transport et les délais clients.",
    });
  }

  if (input.vehiclesImmobilizedOver48h > 0) {
    decisions.push({
      id: "fleet-immobilized",
      severity: "warning",
      title:
        input.vehiclesImmobilizedOver48h === 1
          ? "1 camion immobilisé atelier > 48 h"
          : `${input.vehiclesImmobilizedOver48h} camions immobilisés atelier > 48 h`,
      recommendation: "Relancer le chef d'atelier sur le déblocage prioritaire.",
    });
  }

  const severityOrder: Record<ManagementTeamDecisionSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return decisions.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
}

export function buildManagementTeamResponse(input: {
  period: ManagementPeriod;
  roleCounts: Map<string, number>;
  driversTotal: number;
  driversActive: number;
  cpcCompliant: number;
  cpcGap: number;
  cpcUrgent: number;
  driverScorecard: ManagementDriverScorecard;
  vehiclesOutOfService: number;
  vehiclesImmobilizedOver48h: number;
  missionsTotal?: number;
  totalKm?: number;
  totalRevenueHT?: number;
  completedWorkOrders?: number;
  averageDowntimeHours?: number;
  partsMovementCount?: number;
  totalRoadExpenses?: number;
}): ManagementTeamResponse {
  const poles = buildManagementTeamPoles(input.roleCounts);
  const appAccounts = poles.reduce((sum, pole) => sum + pole.appAccountCount, 0);

  const underperformingDrivers = input.driverScorecard.needsAttention.filter(
    (item) => item.overallScore != null && item.overallScore < 60 && item.incidentCount === 0,
  ).length;

  const decisions = buildManagementTeamDecisions({
    cpcGap: input.cpcGap,
    cpcUrgent: input.cpcUrgent,
    driversWithIncidents: input.driverScorecard.summary.driversWithIncidents,
    underperformingDrivers,
    vehiclesOutOfService: input.vehiclesOutOfService,
    vehiclesImmobilizedOver48h: input.vehiclesImmobilizedOver48h,
  });

  // Calcul de la mobilité
  const onRoadCount = input.driversActive;
  const availableCount = Math.max(0, input.driversTotal - input.driversActive);
  const onLeaveCount = 0;
  const mobilizationRate =
    input.driversTotal > 0 ? (input.driversActive / input.driversTotal) * 100 : 0;

  // Calcul de la productivité des pôles
  const missionsTotal = input.missionsTotal ?? 0;
  const totalKm = input.totalKm ?? 0;
  const averageRevenuePerDriver =
    input.driversActive > 0 && input.totalRevenueHT
      ? Math.round(input.totalRevenueHT / input.driversActive)
      : 0;

  const productivity: PoleProductivity = {
    operations: {
      missionsTotal,
      totalKm,
      averageRevenuePerDriver,
    },
    workshop: {
      completedWorkOrders: input.completedWorkOrders ?? 0,
      averageDowntimeHours: input.averageDowntimeHours ?? 0,
    },
    warehouse: {
      partsMovementCount: input.partsMovementCount ?? 0,
    },
  };

  // Palmarès des chauffeurs
  const topPerformers: DriverBonusItem[] = input.driverScorecard.topPerformers
    .slice(0, 4)
    .map((d) => ({
      driverId: d.driverId,
      driverName: d.driverName,
      overallScore: Math.round(d.overallScore ?? 0),
      averageConsumptionL100: d.averageConsumptionL100,
      missionCount: d.missionCount,
    }));

  const needsTraining: DriverTrainingNeedItem[] = input.driverScorecard.needsAttention
    .slice(0, 3)
    .map((d) => ({
      driverId: d.driverId,
      driverName: d.driverName,
      overallScore: Math.round(d.overallScore ?? 0),
      reason:
        d.incidentCount > 0
          ? `${d.incidentCount} incident(s) signalés`
          : d.averageConsumptionL100 && d.averageConsumptionL100 > 38
          ? `Surconsommation (${d.averageConsumptionL100.toFixed(1)} L/100)`
          : "Ponctualité ou éco-conduite perfectible",
    }));

  return {
    period: input.period,
    summary: {
      appAccounts,
      driversField: input.driversTotal,
      driversActive: input.driversActive,
    },
    poles,
    drivers: {
      cpcCompliant: input.cpcCompliant,
      cpcGap: input.cpcGap,
      cpcUrgent: input.cpcUrgent,
    },
    mobility: {
      onRoadCount,
      availableCount,
      onLeaveCount,
      mobilizationRate,
    },
    productivity,
    rewards: {
      totalRoadExpenses: input.totalRoadExpenses ?? 0,
      topPerformers,
      needsTraining,
    },
    decisions,
  };
}
