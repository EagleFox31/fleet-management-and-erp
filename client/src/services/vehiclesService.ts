import { vehiclesApi } from "@/lib/api-calls";

export interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  vehicleType: string;
  status: 'operational' | 'maintenance' | 'out_of_service';
  fuelType: string;
  ownerId?: number;
  nextMaintenanceDate?: string;
  nextMaintenanceMileage?: number;
}

export interface VehicleStats {
  totalVehicles: number;
  operational: number;
  maintenance: number;
  outOfService: number;
  averageMileage: number;
  upcomingMaintenance: number;
}

export interface VehicleStatusSummary {
  status: 'operational' | 'maintenance' | 'out_of_service';
  count: number;
  percentage: number;
}

export const vehiclesService = {
  async getAll(): Promise<Vehicle[]> {
    const response = await vehiclesApi.getAll();
    const data = await response.json();
    return data;
  },

  async getById(id: number): Promise<Vehicle> {
    const response = await vehiclesApi.getById(id);
    const data = await response.json();
    return data;
  },

  async getByRegistration(registration: string): Promise<Vehicle> {
    const response = await vehiclesApi.getByRegistration(registration);
    const data = await response.json();
    return data;
  },

  async create(vehicleData: any): Promise<Vehicle> {
    const response = await vehiclesApi.create(vehicleData);
    const data = await response.json();
    return data;
  },

  async update(id: number, vehicleData: any): Promise<Vehicle> {
    const response = await vehiclesApi.update(id, vehicleData);
    const data = await response.json();
    return data;
  },

  async delete(id: number): Promise<void> {
    await vehiclesApi.delete(id);
  },

  async getStats(): Promise<VehicleStats> {
    const response = await vehiclesApi.getStats();
    const data = await response.json();
    return data;
  },

  async getStatusSummary(): Promise<VehicleStatusSummary[]> {
    const response = await vehiclesApi.getStatusSummary();
    const data = await response.json();
    return data;
  },

  getStatusLabel(status: 'operational' | 'maintenance' | 'out_of_service'): string {
    switch (status) {
      case 'operational':
        return 'Opérationnel';
      case 'maintenance':
        return 'En maintenance';
      case 'out_of_service':
        return 'Hors service';
    }
  },

  getStatusColor(status: 'operational' | 'maintenance' | 'out_of_service'): string {
    switch (status) {
      case 'operational':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'maintenance':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'out_of_service':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
  },

  formatMileage(mileage: number): string {
    return `${mileage.toLocaleString('fr-FR')} km`;
  },

  calculateMaintenanceDue(currentMileage: number, nextMaintenanceMileage?: number): number | null {
    if (!nextMaintenanceMileage) return null;
    return nextMaintenanceMileage - currentMileage;
  },

  isMaintenanceOverdue(currentMileage: number, nextMaintenanceMileage?: number, nextMaintenanceDate?: string): boolean {
    if (nextMaintenanceMileage && currentMileage >= nextMaintenanceMileage) {
      return true;
    }
    if (nextMaintenanceDate && new Date(nextMaintenanceDate) <= new Date()) {
      return true;
    }
    return false;
  },

  getVehicleTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      tracteur: 'Tracteur',
      porteur: 'Porteur',
      semi_remorque: 'Semi-remorque',
      remorque: 'Remorque',
      utilitaire: 'Utilitaire',
      autre: 'Autre',
    };
    return labels[type] || type;
  },
};
