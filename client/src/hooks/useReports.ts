import { reportsService, DashboardKPIs } from "@/services/reportsService";
import { useVehicles } from "./useVehicles";
import { useWarehouse } from "./useWarehouse";
import { useFuelCard } from "./useFuelCard";
import { useAlerts } from "./useAlerts";
import { useMaintenance } from "./useMaintenance";
import { useMemo } from "react";

export function useReports() {
  return {
    service: reportsService,
  };
}

export function useDashboardKPIs(): {
  data: DashboardKPIs | null;
  isLoading: boolean;
  error: any;
} {
  const { stats: vehicleStats } = useVehicles();
  const { inventoryValue } = useWarehouse();
  const { balance } = useFuelCard();
  const { count: alertsCount } = useAlerts();
  const { workOrders } = useMaintenance();

  const isLoading = 
    vehicleStats.isLoading ||
    inventoryValue.isLoading ||
    balance.isLoading ||
    alertsCount.isLoading ||
    workOrders.isLoading;

  const error = 
    vehicleStats.error ||
    inventoryValue.error ||
    balance.error ||
    alertsCount.error ||
    workOrders.error;

  const data = useMemo(() => {
    if (isLoading || error) return null;

    const vehicleStatsData = vehicleStats.data as any;
    const inventoryData = inventoryValue.data as any;
    const balanceData = balance.data as any;
    const alertsData = alertsCount.data as any;
    const workOrdersData = workOrders.data as any;

    return {
      totalVehicles: vehicleStatsData?.totalVehicles || 0,
      operationalVehicles: vehicleStatsData?.operational || 0,
      maintenanceVehicles: vehicleStatsData?.maintenance || 0,
      inventoryValue: inventoryData?.totalValue || 0,
      fuelBalance: balanceData?.currentBalance || 0,
      activeAlerts: alertsData?.unread || 0,
      pendingWorkOrders: workOrdersData?.filter((wo: any) => wo.status === 'pending')?.length || 0,
      lowStockItems: inventoryData?.categoriesCount || 0,
    };
  }, [
    vehicleStats.data,
    inventoryValue.data,
    balance.data,
    alertsCount.data,
    workOrders.data,
    isLoading,
    error,
  ]);

  return {
    data,
    isLoading,
    error,
  };
}
