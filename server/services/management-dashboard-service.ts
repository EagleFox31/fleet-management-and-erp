import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  computeTrendPercent,
  extractCargoLabel,
  type ManagementDashboardResponse,
  type ManagementPeriod,
  MANAGEMENT_PREVIOUS_PERIOD_LABELS,
  resolvePeriodRange,
  resolvePreviousPeriodRange,
  toIsoDateOnly,
} from "@shared/constants/management-dashboard";
import {
  clientInvoices,
  clients,
  fuelRecords,
  missions,
  supplierInvoices,
  workOrders,
} from "@shared/schema";
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

    const [current, previous, fleetStats] = await Promise.all([
      this.aggregatePeriodMetrics(currentRange.start, currentRange.end),
      this.aggregatePeriodMetrics(previousRange.start, previousRange.end),
      vehicleStatusService.getFleetStatistics(),
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
      alerts: {
        overdueInvoices: current.overdueInvoices,
        outOfServiceVehicles: fleetStats.outOfService,
      },
    };
  }

  private async aggregatePeriodMetrics(start: Date, end: Date): Promise<PeriodMetrics> {
    const startIso = toIsoDateOnly(start);
    const endIso = toIsoDateOnly(end);

    const invoiceRows = await db
      .select({
        invoice: clientInvoices,
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

    const [fuelRow] = await db
      .select({
        total: sql<string>`COALESCE(SUM(COALESCE(${fuelRecords.debitAmount}, ${fuelRecords.cost}, 0)), 0)`,
      })
      .from(fuelRecords)
      .where(and(gte(fuelRecords.date, startIso), lte(fuelRecords.date, endIso)));

    const [maintenanceRow] = await db
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
      );

    const [supplierRow] = await db
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
      );

    const fuel = parseAmount(fuelRow?.total);
    const maintenance = parseAmount(maintenanceRow?.total);
    const suppliers = parseAmount(supplierRow?.total);
    const expensesTotal = fuel + maintenance + suppliers;
    const grossHT = invoicedHT - expensesTotal;
    const marginPercent = invoicedHT > 0 ? (grossHT / invoicedHT) * 100 : 0;

    const missionRows = await db
      .select()
      .from(missions)
      .where(
        and(
          inArray(missions.status, ["in_progress", "delivered", "completed"]),
          gte(missions.deliveryDate, start),
          lte(missions.deliveryDate, end),
        ),
      );

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
}

export const managementDashboardService = new ManagementDashboardService();
