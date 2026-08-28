import { apiRequest } from "@/lib/queryClient";

export interface MissionStatistics {
  totalMissions: number;
  totalFuelConsumed: number;
  totalCost: number;
  totalRevenue: number;
  margin: number;
  marginPercentage: number;
}

export interface Mission {
  id: number;
  date: string;
  vehicleId: number;
  fuelRecordId: number | null;
  departure: string;
  destination: string;
  clientName: string;
  fuelConsumption: number | null;
  fuelCost: number | null;
  roadExpenses: number | null;
  totalCost: number | null;
  invoiceAmount: number | null;
  status: string;
}

export interface MissionsByClientResponse {
  missions: Mission[];
  statistics: MissionStatistics;
}

export interface ClientSummary {
  clientName: string;
  totalMissions: number;
  totalFuelConsumed: number;
  totalCost: number;
  totalRevenue: number;
  margin: number;
  marginPercentage: number;
}

export interface DestinationStats {
  destination: string;
  count: number;
  totalFuel: number;
  totalCost: number;
  totalRevenue: number;
}

export interface MissionCosts {
  fuelCost: number;
  roadExpenses: number;
  vehicleCost: number;
  totalCost: number;
  breakdown: {
    fuel: number;
    road: number;
    vehicle: number;
  };
}

export interface MissionFormData {
  fuelRecordId: number;
  clientName: string;
  roadExpenses: number;
  invoiceAmount?: number;
}

export interface UpcomingMission {
  id: number;
  date: string;
  clientName: string;
  destination: string;
  vehicleId: number;
  estimatedCost: number;
}

export interface ActiveMission {
  id: number;
  date: string;
  clientName: string;
  destination: string;
  vehicleId: number;
  currentCost: number;
  status: string;
}

export const operationsService = {
  async getStatsByClient(): Promise<ClientSummary[]> {
    const response = await apiRequest("GET", "/api/operations/stats/by-client");
    if (!response.ok) {
      throw new Error("Failed to fetch stats by client");
    }
    return await response.json();
  },

  async getStatsByDestination(): Promise<Record<string, DestinationStats>> {
    const response = await apiRequest("GET", "/api/operations/stats/by-destination");
    if (!response.ok) {
      throw new Error("Failed to fetch stats by destination");
    }
    return await response.json();
  },

  async getStatsSummary(): Promise<MissionStatistics> {
    const response = await apiRequest("GET", "/api/operations/stats/summary");
    if (!response.ok) {
      throw new Error("Failed to fetch stats summary");
    }
    return await response.json();
  },

  async getMissionsByClient(
    clientName: string,
    filters?: { startDate?: string; endDate?: string }
  ): Promise<MissionsByClientResponse> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append("startDate", filters.startDate);
    if (filters?.endDate) params.append("endDate", filters.endDate);
    
    const encodedClientName = encodeURIComponent(clientName);
    const url = `/api/operations/missions/by-client/${encodedClientName}${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await apiRequest("GET", url);
    
    if (!response.ok) {
      throw new Error("Failed to fetch missions by client");
    }
    return await response.json();
  },

  async getMissionCosts(missionId: number): Promise<MissionCosts> {
    const response = await apiRequest("GET", `/api/operations/missions/${missionId}/costs`);
    if (!response.ok) {
      throw new Error("Failed to fetch mission costs");
    }
    return await response.json();
  },

  async getUpcomingMissions(): Promise<UpcomingMission[]> {
    const response = await apiRequest("GET", "/api/operations/missions/upcoming");
    if (!response.ok) {
      throw new Error("Failed to fetch upcoming missions");
    }
    return await response.json();
  },

  async getActiveMissions(): Promise<ActiveMission[]> {
    const response = await apiRequest("GET", "/api/operations/missions/active");
    if (!response.ok) {
      throw new Error("Failed to fetch active missions");
    }
    return await response.json();
  },

  async createMissionFromFuel(data: MissionFormData): Promise<Mission> {
    const response = await apiRequest("POST", "/api/operations/missions/from-fuel", data);
    if (!response.ok) {
      throw new Error("Failed to create mission");
    }
    return await response.json();
  },

  async completeMission(missionId: number, completionData: {
    actualCost?: number;
    notes?: string;
  }): Promise<Mission> {
    const response = await apiRequest("POST", "/api/operations/missions/complete", {
      missionId,
      ...completionData,
    });
    if (!response.ok) {
      throw new Error("Failed to complete mission");
    }
    return await response.json();
  },

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  },

  formatNumber(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  },
};
