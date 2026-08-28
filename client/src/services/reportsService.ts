export interface DashboardKPIs {
  totalVehicles: number;
  operationalVehicles: number;
  maintenanceVehicles: number;
  inventoryValue: number;
  fuelBalance: number;
  activeAlerts: number;
  pendingWorkOrders: number;
  lowStockItems: number;
}

export interface FinancialReport {
  period: string;
  totalExpenses: number;
  maintenanceCosts: number;
  fuelCosts: number;
  partsCosts: number;
  laborCosts: number;
}

export interface VehicleUtilizationReport {
  vehicleId: number;
  registrationNumber: string;
  utilizationRate: number;
  totalKm: number;
  activeHours: number;
  maintenanceDowntime: number;
}

export interface MaintenanceReport {
  period: string;
  totalWorkOrders: number;
  completedWorkOrders: number;
  preventiveMaintenance: number;
  correctiveMaintenance: number;
  averageCompletionTime: number;
  totalCost: number;
}

export interface FuelConsumptionReport {
  period: string;
  totalConsumption: number;
  totalCost: number;
  averageConsumption: number;
  anomaliesDetected: number;
  topConsumers: Array<{
    vehicleId: number;
    registrationNumber: string;
    consumption: number;
    cost: number;
  }>;
}

export interface InventoryReport {
  period: string;
  totalValue: number;
  partsCount: number;
  stockMovements: number;
  reorderAlerts: number;
  topUsedParts: Array<{
    partId: number;
    partName: string;
    usageCount: number;
  }>;
}

export const reportsService = {
  async generateDashboardKPIs(
    inventoryValue?: number,
    fuelBalance?: number,
    activeAlerts?: number,
    vehicleStats?: any,
    workOrdersData?: any
  ): Promise<DashboardKPIs> {
    return {
      totalVehicles: vehicleStats?.totalVehicles || 0,
      operationalVehicles: vehicleStats?.operational || 0,
      maintenanceVehicles: vehicleStats?.maintenance || 0,
      inventoryValue: inventoryValue || 0,
      fuelBalance: fuelBalance || 0,
      activeAlerts: activeAlerts || 0,
      pendingWorkOrders: workOrdersData?.filter((wo: any) => wo.status === 'pending')?.length || 0,
      lowStockItems: 0,
    };
  },

  async generateFinancialReport(
    startDate: string,
    endDate: string,
    invoices?: any[],
    fuelRecords?: any[],
    workOrders?: any[]
  ): Promise<FinancialReport> {
    const period = `${startDate} - ${endDate}`;
    
    const maintenanceCosts = workOrders?.reduce((sum, wo) => sum + (wo.actualCost || 0), 0) || 0;
    const fuelCosts = fuelRecords?.reduce((sum, rec) => sum + (rec.debitAmount || 0), 0) || 0;
    const partsCosts = invoices?.filter(inv => inv.family === 'Pieces')
      .reduce((sum, inv) => sum + inv.amount, 0) || 0;
    
    return {
      period,
      totalExpenses: maintenanceCosts + fuelCosts + partsCosts,
      maintenanceCosts,
      fuelCosts,
      partsCosts,
      laborCosts: 0,
    };
  },

  async generateVehicleUtilizationReport(vehicles?: any[]): Promise<VehicleUtilizationReport[]> {
    if (!vehicles) return [];
    
    return vehicles.map(v => ({
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      utilizationRate: 0,
      totalKm: v.mileage || 0,
      activeHours: 0,
      maintenanceDowntime: 0,
    }));
  },

  async generateMaintenanceReport(
    startDate: string,
    endDate: string,
    workOrders?: any[]
  ): Promise<MaintenanceReport> {
    const period = `${startDate} - ${endDate}`;
    
    if (!workOrders) {
      return {
        period,
        totalWorkOrders: 0,
        completedWorkOrders: 0,
        preventiveMaintenance: 0,
        correctiveMaintenance: 0,
        averageCompletionTime: 0,
        totalCost: 0,
      };
    }

    const filteredWorkOrders = workOrders.filter(wo => {
      const woDate = new Date(wo.scheduledDate);
      return woDate >= new Date(startDate) && woDate <= new Date(endDate);
    });

    return {
      period,
      totalWorkOrders: filteredWorkOrders.length,
      completedWorkOrders: filteredWorkOrders.filter(wo => wo.status === 'completed').length,
      preventiveMaintenance: filteredWorkOrders.filter(wo => wo.type === 'preventive').length,
      correctiveMaintenance: filteredWorkOrders.filter(wo => wo.type === 'corrective').length,
      averageCompletionTime: 0,
      totalCost: filteredWorkOrders.reduce((sum, wo) => sum + (wo.actualCost || 0), 0),
    };
  },

  async generateFuelConsumptionReport(
    startDate: string,
    endDate: string,
    consumptionRecords?: any[]
  ): Promise<FuelConsumptionReport> {
    const period = `${startDate} - ${endDate}`;
    
    if (!consumptionRecords) {
      return {
        period,
        totalConsumption: 0,
        totalCost: 0,
        averageConsumption: 0,
        anomaliesDetected: 0,
        topConsumers: [],
      };
    }

    const filteredRecords = consumptionRecords.filter(rec => {
      const recDate = new Date(rec.date);
      return recDate >= new Date(startDate) && recDate <= new Date(endDate);
    });

    return {
      period,
      totalConsumption: filteredRecords.reduce((sum, rec) => sum + (rec.debitQuantity || 0), 0),
      totalCost: filteredRecords.reduce((sum, rec) => sum + (rec.debitAmount || 0), 0),
      averageConsumption: 0,
      anomaliesDetected: 0,
      topConsumers: [],
    };
  },

  async generateInventoryReport(
    startDate: string,
    endDate: string,
    inventoryData?: any
  ): Promise<InventoryReport> {
    const period = `${startDate} - ${endDate}`;
    
    return {
      period,
      totalValue: inventoryData?.totalValue || 0,
      partsCount: inventoryData?.partsCount || 0,
      stockMovements: 0,
      reorderAlerts: inventoryData?.reorderAlerts?.length || 0,
      topUsedParts: [],
    };
  },

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XAF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  },

  formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  },

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  },

  formatDateRange(startDate: string, endDate: string): string {
    return `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`;
  },
};
