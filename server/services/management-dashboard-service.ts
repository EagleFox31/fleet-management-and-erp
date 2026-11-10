import { publicClientInvoiceColumns } from "../lib/client-public-columns";
import { and, eq, gte, ilike, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  computeTrendPercent,
  extractCargoLabel,
  type ManagementDashboardResponse,
  type ManagementExecutiveKpis,
  type ManagementPeriod,
  MANAGEMENT_PREVIOUS_PERIOD_LABELS,
  resolvePeriodRange,
  resolvePreviousPeriodRange,
  toIsoDateOnly,
} from "@shared/constants/management-dashboard";
import { buildManagementExecutiveKpis } from "@shared/constants/management-executive-kpis";
import {
  buildManagementMissionProfitability,
  buildMissionProfitabilityItem,
  sumMissionActualRoadExpensesHT,
  type ManagementMissionProfitability,
} from "@shared/constants/management-mission-profitability";
import { TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN, INSURANCE_SUPPLIER_CATEGORY_ILIKE_PATTERN } from "@shared/constants/supplier-categories";
import {
  buildManagementVehicleTco,
  buildManagementVehicleTcoItem,
  type ManagementVehicleTco,
} from "@shared/constants/management-vehicle-tco";
import {
  buildManagementDriverScorecard,
  buildManagementDriverScorecardItem,
  computeFleetMedianConsumptionL100,
  computeMissionConsumptionL100,
  extractMissionActualDeliveryDate,
  parseMissionOrderNumberFromAlertMessage,
  type DriverMissionMetricsInput,
  type ManagementDriverScorecard,
} from "@shared/constants/management-driver-scorecard";
import {
  buildManagementVehicleObsolescence,
  buildManagementVehicleObsolescenceItem,
  type ManagementVehicleObsolescence,
} from "@shared/constants/management-vehicle-obsolescence";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import { type LiveCorridorVehicle } from "@shared/constants/cemac-corridors";
import { buildCorridorVehicle } from "./corridor-fleet";
import {
  alerts,
  assignments,
  clientInvoices,
  clients,
  drivers,
  fuelRecords,
  missions,
  supplierInvoices,
  suppliers,
  vehicles,
  workOrders,
} from "@shared/schema";
import { VOID_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import { db } from "../db";
import { vehicleStatusService } from "./vehicle-status-service";

function parseAmount(value: string | number | null | undefined): number {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

type PeriodMetrics = {
  revenue: ManagementDashboardResponse["revenue"];
  expenses: ManagementDashboardResponse["expenses"];
  result: ManagementDashboardResponse["result"];
  topClients: ManagementDashboardResponse["topClients"];
  topDestinations: ManagementDashboardResponse["topDestinations"];
  topCargoTypes: ManagementDashboardResponse["topCargoTypes"];
  overdueInvoices: number;
};

export class ManagementDashboardService {
  async getDashboard(period: ManagementPeriod = "month"): Promise<ManagementDashboardResponse> {
    const currentRange = resolvePeriodRange(period);
    const previousRange = resolvePreviousPeriodRange(period);

    const executiveKpisPromise = this.aggregateExecutiveKpis(currentRange.start, currentRange.end);
    const missionProfitabilityPromise = executiveKpisPromise.then((executiveKpis) =>
      this.aggregateMissionProfitability(
        currentRange.start,
        currentRange.end,
        executiveKpis.cpkMaintenance.fcfPerKm,
      ),
    );
    const vehicleTcoPromise = this.aggregateVehicleTco(currentRange.start, currentRange.end);
    const driverScorecardPromise = this.aggregateDriverScorecard(currentRange.start, currentRange.end);
    const periodDays = Math.max(
      1,
      Math.ceil((currentRange.end.getTime() - currentRange.start.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const vehicleObsolescencePromise = this.aggregateVehicleObsolescence(
      currentRange.start,
      currentRange.end,
      periodDays,
      currentRange.end,
    );
    const corridorFleetPromise = this.aggregateCorridorFleet();

    const [
      current,
      previous,
      fleetStats,
      executiveKpis,
      missionProfitability,
      vehicleTco,
      driverScorecard,
      vehicleObsolescence,
      corridorFleet,
    ] = await Promise.all([
      this.aggregatePeriodMetrics(currentRange.start, currentRange.end),
      this.aggregatePeriodMetrics(previousRange.start, previousRange.end),
      vehicleStatusService.getFleetStatistics(),
      executiveKpisPromise,
      missionProfitabilityPromise,
      vehicleTcoPromise,
      driverScorecardPromise,
      vehicleObsolescencePromise,
      corridorFleetPromise,
    ]);

    const fleetTotal =
      fleetStats.operational + fleetStats.maintenance + fleetStats.outOfService;

    return {
      period,
      periodStart: toIsoDateOnly(currentRange.start),
      periodEnd: toIsoDateOnly(currentRange.end),
      previousPeriodStart: toIsoDateOnly(previousRange.start),
      previousPeriodEnd: toIsoDateOnly(previousRange.end),
      revenue: current.revenue,
      expenses: current.expenses,
      result: current.result,
      fleet: {
        operational: fleetStats.operational,
        maintenance: fleetStats.maintenance,
        outOfService: fleetStats.outOfService,
        total: fleetTotal,
      },
      topClients: current.topClients,
      topDestinations: current.topDestinations,
      topCargoTypes: current.topCargoTypes,
      trends: {
        previousPeriodLabel: MANAGEMENT_PREVIOUS_PERIOD_LABELS[period],
        revenueTTC: computeTrendPercent(current.revenue.invoicedTTC, previous.revenue.invoicedTTC),
        expensesTotal: computeTrendPercent(current.expenses.total, previous.expenses.total),
        grossHT: computeTrendPercent(current.result.grossHT, previous.result.grossHT),
        marginPercent: computeTrendPercent(current.result.marginPercent, previous.result.marginPercent),
      },
      executiveKpis,
      missionProfitability,
      vehicleTco,
      driverScorecard,
      vehicleObsolescence,
      corridorFleet,
      alerts: {
        overdueInvoices: current.overdueInvoices,
        outOfServiceVehicles: fleetStats.outOfService,
        vehiclesImmobilizedOver48h: executiveKpis.vehiclesImmobilizedOver48h,
      },
    };
  }

  private async aggregateExecutiveKpis(start: Date, end: Date): Promise<ManagementExecutiveKpis> {
    const startIso = toIsoDateOnly(start);
    const endIso = toIsoDateOnly(end);

    const completedAt = sql`COALESCE(${workOrders.endDate}, ${workOrders.updatedAt})`;
    const immobilizationStart = sql`COALESCE(${workOrders.startDate}, ${workOrders.createdAt})`;
    const downtimeMinutesExpr = sql<number>`COALESCE(
      ${workOrders.duration},
      GREATEST(
        EXTRACT(EPOCH FROM (${completedAt} - ${immobilizationStart})) / 60,
        0
      )
    )`;

    const [missionKmRow, downtimeRow, immobilizedRow, expenseRows] = await Promise.all([
      db
        .select({
          totalKm: sql<string>`COALESCE(SUM(${missions.actualDistance}) FILTER (WHERE ${missions.actualDistance} IS NOT NULL AND ${missions.actualDistance} > 0), 0)`,
          missionCount: sql<string>`COUNT(*) FILTER (WHERE ${missions.actualDistance} IS NOT NULL AND ${missions.actualDistance} > 0)::text`,
          eligibleMissionCount: sql<string>`COUNT(*)::text`,
          missionsExcludedMissingKm: sql<string>`COUNT(*) FILTER (WHERE ${missions.actualDistance} IS NULL OR ${missions.actualDistance} <= 0)::text`,
        })
        .from(missions)
        .where(
          and(
            inArray(missions.status, ["in_progress", "delivered", "completed"]),
            gte(missions.deliveryDate, start),
            lte(missions.deliveryDate, end),
          ),
        ),
      db
        .select({
          totalMinutes: sql<string>`COALESCE(SUM(${downtimeMinutesExpr}), 0)`,
          completedCount: sql<string>`COUNT(*)::text`,
        })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, "completed"),
            gte(completedAt, start),
            lte(completedAt, end),
          ),
        ),
      db
        .select({
          count: sql<string>`COUNT(DISTINCT ${workOrders.vehicleId})::text`,
        })
        .from(workOrders)
        .where(
          and(
            inArray(workOrders.status, ["pending", "in_progress", "awaiting_parts"]),
            lte(immobilizationStart, sql`NOW() - INTERVAL '48 hours'`),
          ),
        ),
      Promise.all([
        db
          .select({
            total: sql<string>`COALESCE(SUM(COALESCE(${fuelRecords.debitAmount}, ${fuelRecords.cost}, 0)), 0)`,
          })
          .from(fuelRecords)
          .where(and(gte(fuelRecords.date, startIso), lte(fuelRecords.date, endIso), isNull(fuelRecords.deletedAt))),
        db
          .select({
            total: sql<string>`COALESCE(SUM(COALESCE(${workOrders.cost}, 0)), 0)`,
          })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.status, "completed"),
              gte(workOrders.createdAt, start),
              lte(workOrders.createdAt, end),
            ),
          ),
        db
          .select({
            total: sql<string>`COALESCE(SUM(${supplierInvoices.amountHT}), 0)`,
          })
          .from(supplierInvoices)
          .where(
            and(
              gte(supplierInvoices.invoiceDate, startIso),
              lte(supplierInvoices.invoiceDate, endIso),
              inArray(supplierInvoices.status, ["received", "validated", "approved", "paid"]),
            ),
          ),
        db
          .select({
            total: sql<string>`COALESCE(SUM(${supplierInvoices.amountHT}), 0)`,
          })
          .from(supplierInvoices)
          .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
          .where(
            and(
              gte(supplierInvoices.invoiceDate, startIso),
              lte(supplierInvoices.invoiceDate, endIso),
              inArray(supplierInvoices.status, ["received", "validated", "approved", "paid"]),
              or(
                ilike(suppliers.category, TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN),
                ilike(supplierInvoices.family, TIRE_SUPPLIER_CATEGORY_ILIKE_PATTERN),
              ),
            ),
          ),
      ]),
    ]);

    const [fuelRow, maintenanceRow, supplierRow, tireSupplierRow] = expenseRows;

    return buildManagementExecutiveKpis({
      totalKm: parseAmount(missionKmRow[0]?.totalKm),
      missionCount: parseInt(missionKmRow[0]?.missionCount ?? "0", 10) || 0,
      missionsExcludedMissingKm:
        parseInt(missionKmRow[0]?.missionsExcludedMissingKm ?? "0", 10) || 0,
      eligibleMissionCount: parseInt(missionKmRow[0]?.eligibleMissionCount ?? "0", 10) || 0,
      fuelHT: parseAmount(fuelRow[0]?.total),
      maintenanceHT: parseAmount(maintenanceRow[0]?.total),
      suppliersHT: parseAmount(supplierRow[0]?.total),
      tireSupplierHT: parseAmount(tireSupplierRow[0]?.total),
      downtimeMinutes: parseAmount(downtimeRow[0]?.totalMinutes),
      completedWorkOrders: parseInt(downtimeRow[0]?.completedCount ?? "0", 10) || 0,
      vehiclesImmobilizedOver48h: parseInt(immobilizedRow[0]?.count ?? "0", 10) || 0,
    });
  }

  private async aggregateMissionProfitability(
    start: Date,
    end: Date,
    cpkMaintenanceFcfPerKm: number | null,
  ): Promise<ManagementMissionProfitability> {
    const missionRows = await db
      .select({
        mission: missions,
        clientName: clients.name,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .where(
        and(
          inArray(missions.status, ["in_progress", "delivered", "completed"]),
          gte(missions.deliveryDate, start),
          lte(missions.deliveryDate, end),
        ),
      );

    if (missionRows.length === 0) {
      return buildManagementMissionProfitability([]);
    }

    const missionIds = missionRows.map((row) => row.mission.id);

    const [invoiceRows, fuelRows] = await Promise.all([
      db
        .select({
          missionId: clientInvoices.missionId,
          totalHT: sql<string>`COALESCE(SUM(${clientInvoices.amountHT}), 0)`,
        })
        .from(clientInvoices)
        .where(
          and(
            inArray(clientInvoices.missionId, missionIds),
            ne(clientInvoices.status, "cancelled"),
          ),
        )
        .groupBy(clientInvoices.missionId),
      db
        .select({
          missionId: fuelRecords.missionId,
          total: sql<string>`COALESCE(SUM(COALESCE(${fuelRecords.debitAmount}, ${fuelRecords.cost}, 0)), 0)`,
        })
        .from(fuelRecords)
        .where(and(inArray(fuelRecords.missionId, missionIds), isNull(fuelRecords.deletedAt)))
        .groupBy(fuelRecords.missionId),
    ]);

    const revenueByMission = new Map<number, number>();
    for (const row of invoiceRows) {
      if (row.missionId != null) {
        revenueByMission.set(row.missionId, parseAmount(row.totalHT));
      }
    }

    const fuelByMission = new Map<number, number>();
    for (const row of fuelRows) {
      if (row.missionId != null) {
        fuelByMission.set(row.missionId, parseAmount(row.total));
      }
    }

    const items = missionRows.map(({ mission, clientName }) =>
      buildMissionProfitabilityItem({
        missionId: mission.id,
        orderNumber: mission.orderNumber,
        clientName: clientName || "Client inconnu",
        destination: mission.deliveryAddress?.trim() || "Non renseigné",
        workflowData: mission.workflowData,
        actualFuelCost: mission.actualFuelCost,
        actualDistance: mission.actualDistance,
        fuelRecordsTotal: fuelByMission.get(mission.id) ?? 0,
        revenueHT: revenueByMission.get(mission.id) ?? 0,
        cpkMaintenanceFcfPerKm,
      }),
    );

    return buildManagementMissionProfitability(items);
  }

  private async aggregateVehicleTco(start: Date, end: Date): Promise<ManagementVehicleTco> {
    const startIso = toIsoDateOnly(start);
    const endIso = toIsoDateOnly(end);

    const [
      vehicleRows,
      fuelRows,
      maintenanceRows,
      insuranceRow,
      missionRows,
      assignmentRows,
      invoiceRows,
    ] = await Promise.all([
      db
        .select({
          id: vehicles.id,
          registrationNumber: vehicles.registrationNumber,
          brand: vehicles.brand,
          model: vehicles.model,
          purchasePrice: vehicles.purchasePrice,
        })
        .from(vehicles)
        .where(sql`${vehicles.deletedAt} IS NULL`),
      db
        .select({
          vehicleId: fuelRecords.vehicleId,
          total: sql<string>`COALESCE(SUM(COALESCE(${fuelRecords.debitAmount}, ${fuelRecords.cost}, 0)), 0)`,
        })
        .from(fuelRecords)
        .where(
          and(
            gte(fuelRecords.date, startIso),
            lte(fuelRecords.date, endIso),
            isNull(fuelRecords.deletedAt),
            sql`${fuelRecords.vehicleId} IS NOT NULL`,
          ),
        )
        .groupBy(fuelRecords.vehicleId),
      db
        .select({
          vehicleId: workOrders.vehicleId,
          total: sql<string>`COALESCE(SUM(COALESCE(${workOrders.cost}, 0)), 0)`,
        })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, "completed"),
            gte(workOrders.createdAt, start),
            lte(workOrders.createdAt, end),
          ),
        )
        .groupBy(workOrders.vehicleId),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${supplierInvoices.amountHT}), 0)`,
        })
        .from(supplierInvoices)
        .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
        .where(
          and(
            gte(supplierInvoices.invoiceDate, startIso),
            lte(supplierInvoices.invoiceDate, endIso),
            inArray(supplierInvoices.status, ["received", "validated", "approved", "paid"]),
            or(
              ilike(suppliers.category, INSURANCE_SUPPLIER_CATEGORY_ILIKE_PATTERN),
              ilike(supplierInvoices.family, INSURANCE_SUPPLIER_CATEGORY_ILIKE_PATTERN),
            ),
          ),
        ),
      db
        .select({ id: missions.id })
        .from(missions)
        .where(
          and(
            inArray(missions.status, ["in_progress", "delivered", "completed"]),
            gte(missions.deliveryDate, start),
            lte(missions.deliveryDate, end),
          ),
        ),
      db
        .select({
          missionId: assignments.missionId,
          vehicleId: assignments.vehicleId,
        })
        .from(assignments)
        // Une affectation annulée ou refusée ne reçoit aucune part du CA.
        .where(and(sql`${assignments.vehicleId} IS NOT NULL`, notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES]))),
      db
        .select({
          missionId: clientInvoices.missionId,
          totalHT: sql<string>`COALESCE(SUM(${clientInvoices.amountHT}), 0)`,
        })
        .from(clientInvoices)
        .where(ne(clientInvoices.status, "cancelled"))
        .groupBy(clientInvoices.missionId),
    ]);

    const periodMissionIds = new Set(missionRows.map((row) => row.id));
    const revenueByMission = new Map<number, number>();
    for (const row of invoiceRows) {
      if (row.missionId != null) {
        revenueByMission.set(row.missionId, parseAmount(row.totalHT));
      }
    }

    const revenueByVehicle = new Map<number, number>();
    const missionCountByVehicle = new Map<number, number>();
    let missionsWithoutRevenueAttribution = 0;

    // Une mission peut avoir plusieurs affectations : son chiffre d'affaires est réparti à parts égales
    // entre ses véhicules distincts (deux chauffeurs sur le même camion = un seul véhicule), et elle
    // n'est comptée qu'une fois sans CA, sinon le CA et les compteurs seraient multipliés.
    const vehiclesByMission = new Map<number, Set<number>>();
    for (const assignment of assignmentRows) {
      if (!periodMissionIds.has(assignment.missionId) || assignment.vehicleId == null) {
        continue;
      }
      const set = vehiclesByMission.get(assignment.missionId) ?? new Set<number>();
      set.add(assignment.vehicleId);
      vehiclesByMission.set(assignment.missionId, set);
    }

    for (const [missionId, vehicleIds] of vehiclesByMission) {
      const revenue = revenueByMission.get(missionId) ?? 0;
      if (revenue <= 0) {
        missionsWithoutRevenueAttribution += 1;
        continue;
      }

      const share = revenue / vehicleIds.size;
      for (const vehicleId of vehicleIds) {
        revenueByVehicle.set(vehicleId, (revenueByVehicle.get(vehicleId) ?? 0) + share);
        missionCountByVehicle.set(vehicleId, (missionCountByVehicle.get(vehicleId) ?? 0) + 1);
      }
    }

    const fuelByVehicle = new Map<number, number>();
    for (const row of fuelRows) {
      if (row.vehicleId != null) {
        fuelByVehicle.set(row.vehicleId, parseAmount(row.total));
      }
    }

    const maintenanceByVehicle = new Map<number, number>();
    for (const row of maintenanceRows) {
      maintenanceByVehicle.set(row.vehicleId, parseAmount(row.total));
    }

    const items = vehicleRows.map((vehicle) =>
      buildManagementVehicleTcoItem({
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        acquisitionHT: parseAmount(vehicle.purchasePrice),
        periodFuelHT: fuelByVehicle.get(vehicle.id) ?? 0,
        periodMaintenanceHT: maintenanceByVehicle.get(vehicle.id) ?? 0,
        revenueHT: revenueByVehicle.get(vehicle.id) ?? 0,
        missionCount: missionCountByVehicle.get(vehicle.id) ?? 0,
      }),
    );

    return buildManagementVehicleTco(items, {
      fleetInsuranceHT: parseAmount(insuranceRow[0]?.total),
      missionsWithoutRevenueAttribution,
    });
  }

  private async aggregateDriverScorecard(start: Date, end: Date): Promise<ManagementDriverScorecard> {
    const [missionRows, assignmentRows, driverRows, incidentAlerts] = await Promise.all([
      db
        .select({
          id: missions.id,
          orderNumber: missions.orderNumber,
          deliveryDate: missions.deliveryDate,
          completedAt: missions.completedAt,
          actualFuelQuantity: missions.actualFuelQuantity,
          actualDistance: missions.actualDistance,
          workflowData: missions.workflowData,
        })
        .from(missions)
        .where(
          and(
            inArray(missions.status, ["in_progress", "delivered", "completed"]),
            gte(missions.deliveryDate, start),
            lte(missions.deliveryDate, end),
          ),
        ),
      db
        .select({
          missionId: assignments.missionId,
          driverId: assignments.driverId,
          completedAt: assignments.completedAt,
        })
        .from(assignments)
        .where(sql`${assignments.driverId} IS NOT NULL`),
      db
        .select({
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
        })
        .from(drivers),
      db
        .select({
          message: alerts.message,
        })
        .from(alerts)
        .where(
          and(
            gte(alerts.createdAt, start),
            lte(alerts.createdAt, end),
            ilike(alerts.message, "%[Mission%"),
          ),
        ),
    ]);

    const periodMissionIds = new Set(missionRows.map((row) => row.id));
    const missionByOrderNumber = new Map(
      missionRows.map((row) => [row.orderNumber, row]),
    );
    const driverNameById = new Map(
      driverRows.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]),
    );

    const missionConsumptionValues: number[] = [];
    for (const mission of missionRows) {
      const consumption = computeMissionConsumptionL100(
        mission.actualFuelQuantity,
        mission.actualDistance,
      );
      if (consumption != null) {
        missionConsumptionValues.push(consumption);
      }
    }
    const fleetMedianConsumptionL100 = computeFleetMedianConsumptionL100(missionConsumptionValues);

    const driverMissionMap = new Map<number, DriverMissionMetricsInput[]>();
    const missionDriverMap = new Map<number, number>();

    for (const assignment of assignmentRows) {
      if (!periodMissionIds.has(assignment.missionId) || assignment.driverId == null) {
        continue;
      }

      missionDriverMap.set(assignment.missionId, assignment.driverId);

      const mission = missionRows.find((row) => row.id === assignment.missionId);
      if (!mission) continue;

      const metrics: DriverMissionMetricsInput = {
        missionId: mission.id,
        actualFuelQuantity: mission.actualFuelQuantity,
        actualDistance: mission.actualDistance,
        plannedDeliveryAt: mission.deliveryDate,
        actualDeliveryAt: extractMissionActualDeliveryDate(
          mission.workflowData,
          mission.completedAt ?? assignment.completedAt,
        ),
      };

      const bucket = driverMissionMap.get(assignment.driverId) ?? [];
      bucket.push(metrics);
      driverMissionMap.set(assignment.driverId, bucket);
    }

    const incidentCountByDriver = new Map<number, number>();
    for (const alert of incidentAlerts) {
      const orderNumber = parseMissionOrderNumberFromAlertMessage(alert.message);
      if (!orderNumber) continue;

      const mission = missionByOrderNumber.get(orderNumber);
      if (!mission || !periodMissionIds.has(mission.id)) continue;

      const driverId = missionDriverMap.get(mission.id);
      if (driverId == null) continue;

      incidentCountByDriver.set(driverId, (incidentCountByDriver.get(driverId) ?? 0) + 1);
    }

    const items = Array.from(driverMissionMap.entries()).map(([driverId, driverMissions]) =>
      buildManagementDriverScorecardItem({
        driverId,
        driverName: driverNameById.get(driverId) ?? `Chauffeur #${driverId}`,
        missions: driverMissions,
        incidentCount: incidentCountByDriver.get(driverId) ?? 0,
        fleetMedianConsumptionL100,
      }),
    );

    return buildManagementDriverScorecard(items);
  }

  private async aggregateVehicleObsolescence(
    start: Date,
    end: Date,
    periodDays: number,
    referenceDate: Date,
  ): Promise<ManagementVehicleObsolescence> {
    const [vehicleRows, maintenanceRows] = await Promise.all([
      db
        .select({
          id: vehicles.id,
          registrationNumber: vehicles.registrationNumber,
          brand: vehicles.brand,
          model: vehicles.model,
          purchasePrice: vehicles.purchasePrice,
          purchaseDate: vehicles.purchaseDate,
        })
        .from(vehicles)
        .where(sql`${vehicles.deletedAt} IS NULL`),
      db
        .select({
          vehicleId: workOrders.vehicleId,
          total: sql<string>`COALESCE(SUM(COALESCE(${workOrders.cost}, 0)), 0)`,
        })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, "completed"),
            gte(workOrders.createdAt, start),
            lte(workOrders.createdAt, end),
          ),
        )
        .groupBy(workOrders.vehicleId),
    ]);

    const maintenanceByVehicle = new Map<number, number>();
    for (const row of maintenanceRows) {
      maintenanceByVehicle.set(row.vehicleId, parseAmount(row.total));
    }

    const items = vehicleRows.map((vehicle) =>
      buildManagementVehicleObsolescenceItem({
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        acquisitionHT: parseAmount(vehicle.purchasePrice),
        purchaseDate: vehicle.purchaseDate ? new Date(vehicle.purchaseDate) : null,
        periodMaintenanceHT: maintenanceByVehicle.get(vehicle.id) ?? 0,
        periodDays,
        referenceDate,
      }),
    );

    return buildManagementVehicleObsolescence(items);
  }

  private async aggregatePeriodMetrics(start: Date, end: Date): Promise<PeriodMetrics> {
    const startIso = toIsoDateOnly(start);
    const endIso = toIsoDateOnly(end);

    const invoiceRows = await db
      .select({
        invoice: publicClientInvoiceColumns,
        clientName: clients.name,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id))
      .where(
        and(
          gte(clientInvoices.invoiceDate, startIso),
          lte(clientInvoices.invoiceDate, endIso),
          ne(clientInvoices.status, "cancelled"),
        ),
      );

    let invoicedHT = 0;
    let invoicedTTC = 0;
    let collectedTTC = 0;
    let outstandingTTC = 0;
    let overdueInvoices = 0;

    const clientsMap = new Map<
      string,
      { clientName: string; invoicedTTC: number; collectedTTC: number; invoiceCount: number }
    >();

    for (const row of invoiceRows) {
      const amountHT = parseAmount(row.invoice.amountHT);
      const amountTTC = parseAmount(row.invoice.amountTTC);
      const balance = parseAmount(row.invoice.balance);
      const paid = Math.max(amountTTC - balance, 0);

      invoicedHT += amountHT;
      invoicedTTC += amountTTC;
      collectedTTC += paid;
      outstandingTTC += balance;

      if (row.invoice.status === "overdue" || (balance > 0 && row.invoice.dueDate < endIso)) {
        overdueInvoices += 1;
      }

      const clientName = row.clientName || "Client inconnu";
      const existing = clientsMap.get(clientName);
      if (existing) {
        existing.invoicedTTC += amountTTC;
        existing.collectedTTC += paid;
        existing.invoiceCount += 1;
      } else {
        clientsMap.set(clientName, {
          clientName,
          invoicedTTC: amountTTC,
          collectedTTC: paid,
          invoiceCount: 1,
        });
      }
    }

    const [fuelRow, maintenanceRow, supplierRow, missionRows] = await Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(COALESCE(${fuelRecords.debitAmount}, ${fuelRecords.cost}, 0)), 0)`,
        })
        .from(fuelRecords)
        .where(and(gte(fuelRecords.date, startIso), lte(fuelRecords.date, endIso), isNull(fuelRecords.deletedAt))),
      db
        .select({
          total: sql<string>`COALESCE(SUM(COALESCE(${workOrders.cost}, 0)), 0)`,
        })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, "completed"),
            gte(workOrders.createdAt, start),
            lte(workOrders.createdAt, end),
          ),
        ),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${supplierInvoices.amountHT}), 0)`,
        })
        .from(supplierInvoices)
        .where(
          and(
            gte(supplierInvoices.invoiceDate, startIso),
            lte(supplierInvoices.invoiceDate, endIso),
            inArray(supplierInvoices.status, ["received", "validated", "approved", "paid"]),
          ),
        ),
      db
        .select()
        .from(missions)
        .where(
          and(
            inArray(missions.status, ["in_progress", "delivered", "completed"]),
            gte(missions.deliveryDate, start),
            lte(missions.deliveryDate, end),
          ),
        ),
    ]);

    const fuel = parseAmount(fuelRow[0]?.total);
    const maintenance = parseAmount(maintenanceRow[0]?.total);
    const suppliers = parseAmount(supplierRow[0]?.total);
    const roadExpensesSummary = sumMissionActualRoadExpensesHT(missionRows);
    const roadExpenses = roadExpensesSummary.totalHT;
    const expensesTotal = fuel + maintenance + suppliers + roadExpenses;
    const grossHT = invoicedHT - expensesTotal;
    const marginPercent = invoicedHT > 0 ? (grossHT / invoicedHT) * 100 : 0;

    const destinationMap = new Map<string, { destination: string; missionCount: number; fuelCost: number }>();
    const cargoMap = new Map<
      string,
      { cargoLabel: string; missionCount: number; fuelCost: number; totalWeight: number }
    >();

    for (const mission of missionRows) {
      const destination = mission.deliveryAddress?.trim() || "Non renseigné";
      const fuelCost = parseAmount(mission.actualFuelCost);
      const cargoLabel = extractCargoLabel(mission.cargo);
      const weight = parseAmount(mission.weight);

      const destinationEntry = destinationMap.get(destination);
      if (destinationEntry) {
        destinationEntry.missionCount += 1;
        destinationEntry.fuelCost += fuelCost;
      } else {
        destinationMap.set(destination, { destination, missionCount: 1, fuelCost });
      }

      const cargoEntry = cargoMap.get(cargoLabel);
      if (cargoEntry) {
        cargoEntry.missionCount += 1;
        cargoEntry.fuelCost += fuelCost;
        cargoEntry.totalWeight += weight;
      } else {
        cargoMap.set(cargoLabel, {
          cargoLabel,
          missionCount: 1,
          fuelCost,
          totalWeight: weight,
        });
      }
    }

    return {
      revenue: {
        invoicedHT,
        invoicedTTC,
        collectedTTC,
        outstandingTTC,
        invoiceCount: invoiceRows.length,
      },
      expenses: {
        fuel,
        maintenance,
        suppliers,
        roadExpenses,
        roadExpensesMissionCount: roadExpensesSummary.missionCount,
        roadExpensesMissingCount: roadExpensesSummary.missingCount,
        total: expensesTotal,
      },
      result: {
        grossHT,
        marginPercent,
      },
      topClients: Array.from(clientsMap.values())
        .sort((a, b) => b.invoicedTTC - a.invoicedTTC)
        .slice(0, 5),
      topDestinations: Array.from(destinationMap.values())
        .sort((a, b) => b.missionCount - a.missionCount)
        .slice(0, 5),
      topCargoTypes: Array.from(cargoMap.values())
        .sort((a, b) => b.missionCount - a.missionCount)
        .slice(0, 5),
      overdueInvoices,
    };
  }

  private async aggregateCorridorFleet(): Promise<LiveCorridorVehicle[]> {
    const vehicleRows = await db
      .select({
        id: vehicles.id,
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        status: vehicles.status,
      })
      .from(vehicles)
      .where(sql`${vehicles.deletedAt} IS NULL`);

    const activeAssignments = await db
      .select({
        vehicleId: assignments.vehicleId,
        missionId: missions.id,
        orderNumber: missions.orderNumber,
        missionStatus: missions.status,
        assignmentStatus: assignments.status,
        pickupAddress: missions.pickupAddress,
        deliveryAddress: missions.deliveryAddress,
        cargo: missions.cargo,
        weight: missions.weight,
        actualDistance: missions.actualDistance,
        actualFuelQuantity: missions.actualFuelQuantity,
        clientName: clients.name,
        driverFirstName: drivers.firstName,
        driverLastName: drivers.lastName,
      })
      .from(assignments)
      .innerJoin(missions, eq(assignments.missionId, missions.id))
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(
        and(
          inArray(missions.status, ["in_progress", "assigned", "planned"]),
          // Seule une affectation active place le véhicule en mission (annulée, refusée, terminée : non).
          inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        ),
      );

    // Une seule mission par véhicule : la plus avancée (en cours avant affectée avant planifiée).
    const missionRank: Record<string, number> = { in_progress: 0, assigned: 1, planned: 2 };
    const assignmentMap = new Map<number, typeof activeAssignments[0]>();
    for (const item of activeAssignments) {
      if (!item.vehicleId) continue;
      const known = assignmentMap.get(item.vehicleId);
      const rank = missionRank[item.missionStatus] ?? 9;
      const knownRank = missionRank[known?.missionStatus ?? ""] ?? 9;
      // À égalité de rang, la mission la plus récente (id le plus grand) : résultat déterministe.
      if (!known || rank < knownRank || (rank === knownRank && item.missionId > known.missionId)) {
        assignmentMap.set(item.vehicleId, item);
      }
    }

    // Aucune position réelle n'est encore lue ici (remontée GPS : GPS-API-1) : pas de coordonnée.
    return vehicleRows.map((vehicle) => {
      const active = assignmentMap.get(vehicle.id);
      return buildCorridorVehicle(
        vehicle,
        active && {
          ...active,
          driverName: active.driverFirstName
            ? `${active.driverFirstName} ${active.driverLastName || ""}`.trim()
            : undefined,
          cargoLabel: active.cargo ? extractCargoLabel(active.cargo) : undefined,
        },
      );
    });
  }
}

export const managementDashboardService = new ManagementDashboardService();
