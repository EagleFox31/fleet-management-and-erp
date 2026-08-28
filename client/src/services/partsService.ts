import { partsApi, tiresApi } from "@/lib/api-calls";

export interface Part {
  id: number;
  reference: string;
  name: string;
  category: string;
  supplier: string;
  unit?: string;
  unitPrice: number;
  currentStock: number;
  minStock: number;
  location: string;
}

export interface PartRequest {
  id: number;
  partId: number;
  partName: string;
  quantity: number;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  notes?: string;
}

export interface Tire {
  id: number;
  brand: string;
  model: string;
  size: string;
  position: string;
  vehicleId?: number;
  vehicleRegistration?: string;
  status: 'in_stock' | 'mounted' | 'worn' | 'damaged';
  treadDepth: number;
  installDate?: string;
  mileage?: number;
}

export interface TireRotation {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  date: string;
  performedBy: string;
  notes?: string;
  tires: Array<{
    tireId: number;
    fromPosition: string;
    toPosition: string;
  }>;
}

export const partsService = {
  async getAllParts(): Promise<Part[]> {
    const response = await partsApi.getAll();
    const data = await response.json();
    return data;
  },

  async getPartById(id: number): Promise<Part> {
    const response = await partsApi.getById(id);
    const data = await response.json();
    return data;
  },

  async createPart(partData: any): Promise<Part> {
    const response = await partsApi.create(partData);
    const data = await response.json();
    return data;
  },

  async updatePart(id: number, partData: any): Promise<Part> {
    const response = await partsApi.update(id, partData);
    const data = await response.json();
    return data;
  },

  async deletePart(id: number): Promise<void> {
    await partsApi.delete(id);
  },

  async getPartRequests(): Promise<PartRequest[]> {
    const response = await partsApi.getRequests();
    const data = await response.json();
    return data;
  },

  async createPartRequest(requestData: any): Promise<PartRequest> {
    const response = await partsApi.createRequest(requestData);
    const data = await response.json();
    return data;
  },

  async getAllTires(): Promise<Tire[]> {
    const response = await tiresApi.getAll();
    const data = await response.json();
    return data;
  },

  async getTireById(id: number): Promise<Tire> {
    const response = await tiresApi.getById(id);
    const data = await response.json();
    return data;
  },

  async createTire(tireData: any): Promise<Tire> {
    const response = await tiresApi.create(tireData);
    const data = await response.json();
    return data;
  },

  async updateTire(id: number, tireData: any): Promise<Tire> {
    const response = await tiresApi.update(id, tireData);
    const data = await response.json();
    return data;
  },

  async deleteTire(id: number): Promise<void> {
    await tiresApi.delete(id);
  },

  async getTireRotations(): Promise<TireRotation[]> {
    const response = await tiresApi.getRotations();
    const data = await response.json();
    return data;
  },

  async createTireRotation(rotationData: any): Promise<TireRotation> {
    const response = await tiresApi.createRotation(rotationData);
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

  getStockStatus(currentStock: number, minStock: number): 'healthy' | 'low' | 'out' {
    if (currentStock === 0) return 'out';
    if (currentStock <= minStock) return 'low';
    return 'healthy';
  },

  getTireStatusLabel(status: 'in_stock' | 'mounted' | 'worn' | 'damaged'): string {
    const labels: Record<string, string> = {
      in_stock: 'En stock',
      mounted: 'Monté',
      worn: 'Usé',
      damaged: 'Endommagé',
    };
    return labels[status] || status;
  },

  getTireStatusColor(status: 'in_stock' | 'mounted' | 'worn' | 'damaged'): string {
    switch (status) {
      case 'in_stock':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'mounted':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'worn':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'damaged':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
  },
};
