import { fuelCardApi } from "@/lib/api-calls";

export interface FuelBalance {
  balance: number;
  fuelBalance: number;
  totalCredits: number;
  totalDebits: number;
  lastCredit: any | null;
  lastDebit: any | null;
  averagePricePerLiter: number;
}

export interface FuelRecharge {
  id: number;
  date: string;
  amount: number;
  reference: string;
  notes?: string;
}

export interface FuelConsumption {
  id: number;
  date: string;
  vehicleId: number;
  vehicleRegistration: string;
  quantity: number;
  amount: number;
  mileage?: number;
}

export interface FuelHistory {
  id: number;
  date: string;
  type: 'recharge' | 'consumption';
  amount: number;
  balance: number;
  reference?: string;
  vehicleRegistration?: string;
}

export interface VehicleFuelStats {
  vehicleId: number;
  vehicleRegistration: string;
  totalConsumption: number;
  totalAmount: number;
  averageConsumption: number;
  transactionCount: number;
}

export interface FuelAnomaly {
  date: string;
  vehicleRegistration: string;
  quantity: number;
  expectedRange: { min: number; max: number };
  deviation: number;
  severity: 'low' | 'medium' | 'high';
}

export interface ClientFuelStats {
  clientId: number;
  clientName: string;
  totalConsumption: number;
  totalAmount: number;
  vehicleCount: number;
}

export interface MonthlyFuelStats {
  month: string;
  recharges: number;
  consumption: number;
  balance: number;
  transactionCount: number;
}

export const fuelCardService = {
  async getBalance(): Promise<FuelBalance> {
    const response = await fuelCardApi.getBalance();
    const data = await response.json();
    return data;
  },

  async getFullHistory(): Promise<FuelHistory[]> {
    const response = await fuelCardApi.getFullHistory();
    const data = await response.json();
    return data;
  },

  async rechargeCard(rechargeData: {
    amount: number;
    quantity: number;
    date: string;
    paymentMode: string;
    orderNumber?: string;
    notes?: string;
  }): Promise<any> {
    const response = await fuelCardApi.rechargeCard(rechargeData);
    const data = await response.json();
    return data;
  },

  async recordConsumption(consumptionData: {
    vehicleId: number;
    quantity: number;
    unitPrice: number;
    date: string;
    stationName: string;
    destination: string;
    clientName?: string;
    notes?: string;
  }): Promise<any> {
    const response = await fuelCardApi.recordConsumption(consumptionData);
    const data = await response.json();
    return data;
  },

  async getVehicleStats(vehicleId: string): Promise<VehicleFuelStats> {
    const response = await fuelCardApi.getVehicleStats(vehicleId);
    const data = await response.json();
    return data;
  },

  async getVehicleAnomalies(vehicleId: string): Promise<{ hasAnomaly: boolean; anomalies: FuelAnomaly[] }> {
    const response = await fuelCardApi.getVehicleAnomalies(vehicleId);
    const data = await response.json();
    return data;
  },

  async getStatsByClient(): Promise<ClientFuelStats[]> {
    const response = await fuelCardApi.getStatsByClient();
    const data = await response.json();
    return data;
  },

  async getMonthlyStats(): Promise<MonthlyFuelStats[]> {
    const response = await fuelCardApi.getMonthlyStats();
    const data = await response.json();
    return data;
  },

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XAF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  },

  formatLiters(liters: number): string {
    return `${liters.toFixed(2)} L`;
  },

  calculateConsumptionRate(totalLiters: number, totalKm: number): number {
    if (totalKm === 0) return 0;
    return (totalLiters / totalKm) * 100;
  },

  formatConsumptionRate(rate: number): string {
    return `${rate.toFixed(2)} L/100km`;
  },

  getAnomalySeverityColor(severity: 'low' | 'medium' | 'high'): string {
    switch (severity) {
      case 'low':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'medium':
        return 'text-orange-600 dark:text-orange-400';
      case 'high':
        return 'text-red-600 dark:text-red-400';
    }
  },
};
