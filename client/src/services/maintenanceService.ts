import { maintenanceApi } from "@/lib/api-calls";

export interface WorkOrder {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  type: 'preventive' | 'corrective' | 'inspection';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  technicianId?: number;
  scheduledDate: string;
  completedDate?: string;
  estimatedCost?: number;
  actualCost?: number;
}

export interface PreventiveSchedule {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  maintenanceType: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'mileage';
  intervalValue: number;
  lastMaintenanceDate?: string;
  nextMaintenanceDate: string;
  nextMaintenanceMileage?: number;
}

export interface FaultCatalogItem {
  id: number;
  code: string;
  description: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimatedRepairTime: number;
  commonCauses: string[];
  recommendedActions: string[];
}

export interface MaintenanceStats {
  totalWorkOrders: number;
  pending: number;
  inProgress: number;
  completed: number;
  averageCompletionTime: number;
  totalCost: number;
  preventivePercentage: number;
}

export const maintenanceService = {
  async getWorkOrders(): Promise<WorkOrder[]> {
    const response = await maintenanceApi.getWorkOrders();
    const data = await response.json();
    return data;
  },

  async getWorkOrderById(id: number): Promise<WorkOrder> {
    const response = await maintenanceApi.getWorkOrderById(id);
    const data = await response.json();
    return data;
  },

  async createWorkOrder(workOrderData: any): Promise<WorkOrder> {
    const response = await maintenanceApi.createWorkOrder(workOrderData);
    const data = await response.json();
    return data;
  },

  async updateWorkOrder(id: number, workOrderData: any): Promise<WorkOrder> {
    const response = await maintenanceApi.updateWorkOrder(id, workOrderData);
    const data = await response.json();
    return data;
  },

  async deleteWorkOrder(id: number): Promise<void> {
    await maintenanceApi.deleteWorkOrder(id);
  },

  async getPreventiveSchedules(): Promise<PreventiveSchedule[]> {
    const response = await maintenanceApi.getPreventiveSchedules();
    const data = await response.json();
    return data;
  },

  async getFaultCatalog(): Promise<FaultCatalogItem[]> {
    const response = await maintenanceApi.getFaultCatalog();
    const data = await response.json();
    return data;
  },

  async getMaintenanceStats(): Promise<MaintenanceStats> {
    const response = await maintenanceApi.getMaintenanceStats();
    const data = await response.json();
    return data;
  },

  getStatusLabel(status: 'pending' | 'in_progress' | 'completed' | 'cancelled'): string {
    switch (status) {
      case 'pending':
        return 'En attente';
      case 'in_progress':
        return 'En cours';
      case 'completed':
        return 'Terminé';
      case 'cancelled':
        return 'Annulé';
    }
  },

  getStatusColor(status: 'pending' | 'in_progress' | 'completed' | 'cancelled'): string {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  },

  getPriorityLabel(priority: 'low' | 'medium' | 'high' | 'urgent'): string {
    switch (priority) {
      case 'low':
        return 'Basse';
      case 'medium':
        return 'Moyenne';
      case 'high':
        return 'Haute';
      case 'urgent':
        return 'Urgente';
    }
  },

  getPriorityColor(priority: 'low' | 'medium' | 'high' | 'urgent'): string {
    switch (priority) {
      case 'low':
        return 'text-gray-600 dark:text-gray-400';
      case 'medium':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'high':
        return 'text-orange-600 dark:text-orange-400';
      case 'urgent':
        return 'text-red-600 dark:text-red-400';
    }
  },

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XAF',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  },

  calculateCompletionTime(scheduledDate: string, completedDate: string): number {
    const scheduled = new Date(scheduledDate);
    const completed = new Date(completedDate);
    const diffTime = Math.abs(completed.getTime() - scheduled.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  },
};
