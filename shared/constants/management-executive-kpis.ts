/** KPI exécutifs Direction — formules pures (testables sans BDD). */

export type ManagementExecutiveKpis = {
  prk: {
    fcfPerKm: number | null;
    totalKm: number;
    directChargesHT: number;
    /** Missions avec `actual_distance` renseigné (> 0). */
    missionCount: number;
    /** Missions éligibles mais sans kilométrage réel — exclues du dénominateur. */
    missionsExcludedMissingKm: number;
    /** Toutes les missions livrées / en cours sur la période. */
    eligibleMissionCount: number;
  };
  cpkMaintenance: {
    fcfPerKm: number | null;
    totalKm: number;
    maintenanceHT: number;
    /** Achats pneus HT via factures fournisseurs (catégorie pneumatique). */
    tireSupplierHT: number;
  };
  downtime: {
    totalImmobilizationHours: number;
    averageHoursPerCompletedOrder: number | null;
    completedWorkOrders: number;
  };
  vehiclesImmobilizedOver48h: number;
};

/** PRK = charges directes HT / km réels parcourus (missions). */
export function computePrkFcfPerKm(directChargesHT: number, totalKm: number): number | null {
  if (totalKm <= 0) {
    return null;
  }
  return directChargesHT / totalKm;
}

/**
 * Charges directes PRK : carburant + atelier + fournisseurs HT.
 * Les pneus sont comptés à l'achat (facture fournisseur), pas via `tire_rotations.cost`.
 */
export function computePrkDirectChargesHT(input: {
  fuelHT: number;
  maintenanceHT: number;
  suppliersHT: number;
}): number {
  return input.fuelHT + input.maintenanceHT + input.suppliersHT;
}

/** CPK maintenance = (OT + achats pneus fournisseur) HT / km réels. */
export function computeCpkMaintenanceFcfPerKm(
  maintenanceHT: number,
  tireSupplierHT: number,
  totalKm: number,
): number | null {
  if (totalKm <= 0) {
    return null;
  }
  return (maintenanceHT + tireSupplierHT) / totalKm;
}

export function computeAverageDowntimeHours(
  totalMinutes: number,
  completedWorkOrders: number,
): number | null {
  if (completedWorkOrders <= 0) {
    return null;
  }
  return totalMinutes / completedWorkOrders / 60;
}

export function buildManagementExecutiveKpis(input: {
  totalKm: number;
  missionCount: number;
  missionsExcludedMissingKm: number;
  eligibleMissionCount: number;
  fuelHT: number;
  maintenanceHT: number;
  suppliersHT: number;
  tireSupplierHT: number;
  downtimeMinutes: number;
  completedWorkOrders: number;
  vehiclesImmobilizedOver48h: number;
}): ManagementExecutiveKpis {
  const directChargesHT = computePrkDirectChargesHT({
    fuelHT: input.fuelHT,
    maintenanceHT: input.maintenanceHT,
    suppliersHT: input.suppliersHT,
  });

  return {
    prk: {
      fcfPerKm: computePrkFcfPerKm(directChargesHT, input.totalKm),
      totalKm: input.totalKm,
      directChargesHT,
      missionCount: input.missionCount,
      missionsExcludedMissingKm: input.missionsExcludedMissingKm,
      eligibleMissionCount: input.eligibleMissionCount,
    },
    cpkMaintenance: {
      fcfPerKm: computeCpkMaintenanceFcfPerKm(
        input.maintenanceHT,
        input.tireSupplierHT,
        input.totalKm,
      ),
      totalKm: input.totalKm,
      maintenanceHT: input.maintenanceHT,
      tireSupplierHT: input.tireSupplierHT,
    },
    downtime: {
      totalImmobilizationHours: Math.round((input.downtimeMinutes / 60) * 10) / 10,
      averageHoursPerCompletedOrder: computeAverageDowntimeHours(
        input.downtimeMinutes,
        input.completedWorkOrders,
      ),
      completedWorkOrders: input.completedWorkOrders,
    },
    vehiclesImmobilizedOver48h: input.vehiclesImmobilizedOver48h,
  };
}
