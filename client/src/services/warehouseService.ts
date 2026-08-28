import { warehouseApi } from "@/lib/api-calls";
import { formatPrice } from "@/lib/utils";

export interface InventoryValue {
  totalValue: number;
  totalParts: number;
  totalQuantity: number;
  byCategory: Record<string, { count: number; value: number; quantity: number }>;
}

export interface ReorderAlertsResponse {
  parts: Array<{
    id: number;
    name: string;
    reference: string;
    category: string;
    unit?: string;
    quantity: number;
    realStock: number | null;
    minQuantity: number;
    unitPrice: number;
    supplier: string;
    reorderAlert: boolean;
    shortage: number;
  }>;
  totalAlerts: number;
  totalShortage: number;
  estimatedCost: number;
}

export interface StockItem {
  partId: number;
  partName: string;
  category: string;
  currentStock: number;
  minStock: number;
  movements: number;
  lastMovementDate: string;
}

export interface StockMovement {
  id: number;
  partId: number;
  partName: string;
  type: 'entry' | 'exit';
  quantity: number;
  date: string;
  reason: string;
}

export interface MostUsedPart {
  partId: number;
  partName: string;
  category: string;
  usageCount: number;
  totalQuantity: number;
}

export interface WarehouseStatistics {
  totalParts: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  averageTurnover: number;
}

export interface PartsBySupplier {
  supplier: string;
  partsCount: number;
  totalValue: number;
  categories: string[];
}

export const warehouseService = {
  async getInventoryValue(): Promise<InventoryValue> {
    const response = await warehouseApi.getInventoryValue();
    const data = await response.json();
    return data;
  },

  async getReorderAlerts(): Promise<ReorderAlertsResponse> {
    const response = await warehouseApi.getReorderAlerts();
    const data = await response.json();
    return data;
  },

  async getPartRealStock(partId: number): Promise<StockItem> {
    const response = await warehouseApi.getPartRealStock(partId);
    const data = await response.json();
    return data;
  },

  async recordStockMovement(movement: {
    partId: number;
    type: 'in' | 'out';
    quantity: number;
    reason: string;
    workOrderId?: number;
    responsiblePerson?: string;
    deliveryReceiptNumber?: string;
  }): Promise<any> {
    const response = await warehouseApi.recordStockMovement(movement);
    const data = await response.json();
    return data;
  },

  async getMostUsedParts(limit?: number): Promise<MostUsedPart[]> {
    const response = await warehouseApi.getMostUsedParts(limit ? { limit } : undefined);
    const data = await response.json();
    return data;
  },

  async getStatistics(): Promise<WarehouseStatistics> {
    const response = await warehouseApi.getStatistics();
    const data = await response.json();
    return data;
  },

  async getPartsBySupplier(): Promise<PartsBySupplier[]> {
    const response = await warehouseApi.getPartsBySupplier();
    const data = await response.json();
    return data;
  },

  formatCurrency(amount: number): string {
    return formatPrice(amount);
  },

  calculateStockHealth(currentStock: number, minStock: number): 'healthy' | 'warning' | 'critical' {
    if (currentStock === 0) return 'critical';
    if (currentStock <= minStock) return 'warning';
    return 'healthy';
  },

  getStockHealthColor(health: 'healthy' | 'warning' | 'critical'): string {
    switch (health) {
      case 'healthy':
        return 'text-green-600 dark:text-green-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'critical':
        return 'text-red-600 dark:text-red-400';
    }
  },
};
