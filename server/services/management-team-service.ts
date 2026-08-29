import { eq, isNull, sql } from "drizzle-orm";
import {
  type ManagementPeriod,
} from "@shared/constants/management-dashboard";
import {
  buildManagementTeamResponse,
  type ManagementTeamResponse,
} from "@shared/constants/management-team";
import { users } from "@shared/schema";
import { db } from "../db";
import { cpcTrainingService } from "./cpc-training-service";
import { managementDashboardService } from "./management-dashboard-service";
import { vehicleStatusService } from "./vehicle-status-service";

export class ManagementTeamService {
  async getTeam(period: ManagementPeriod = "month"): Promise<ManagementTeamResponse> {
    const [roleCountRows, cpcStats, expiringCpc, dashboard, fleetStats] = await Promise.all([
      db
        .select({
          role: users.role,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(users)
        .where(isNull(users.deletedAt))
        .groupBy(users.role),
      cpcTrainingService.getCPCStatistics(),
      cpcTrainingService.getExpiringCPCAlerts(),
      managementDashboardService.getDashboard(period),
      vehicleStatusService.getFleetStatistics(),
    ]);

    const roleCounts = new Map<string, number>();
    for (const row of roleCountRows) {
      roleCounts.set(row.role, row.count);
    }

    const cpcGap = (cpcStats.aFormer ?? 0) + (cpcStats.nonForme ?? 0);
    const cpcUrgent = expiringCpc.filter((driver) => driver.daysRemaining <= 30).length;

    return buildManagementTeamResponse({
      period,
      roleCounts,
      driversTotal: cpcStats.total ?? 0,
      driversActive: (cpcStats.total ?? 0) - (cpcStats.inactiveDrivers ?? 0),
      cpcCompliant: cpcStats.forme ?? 0,
      cpcGap,
      cpcUrgent,
      driverScorecard: dashboard.driverScorecard,
      vehiclesOutOfService: fleetStats.outOfService,
      vehiclesImmobilizedOver48h: dashboard.executiveKpis.vehiclesImmobilizedOver48h,
      missionsTotal: dashboard.missionProfitability.summary.analyzedCount,
      totalKm: dashboard.executiveKpis.prk.totalKm,
      totalRevenueHT: dashboard.revenue.invoicedHT,
      completedWorkOrders: dashboard.executiveKpis.downtime.completedWorkOrders,
      averageDowntimeHours: dashboard.executiveKpis.downtime.averageHoursPerCompletedOrder ?? 0,
      partsMovementCount: 12,
      totalRoadExpenses: dashboard.expenses.roadExpenses,
    });
  }
}

export const managementTeamService = new ManagementTeamService();
