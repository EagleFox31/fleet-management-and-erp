import { apiRequest } from "@/lib/queryClient";

// ============================================
// WAREHOUSE & INVENTORY API CALLS
// ============================================

export const warehouseApi = {
  // Routes GET qui existent vraiment dans server/api/warehouse.routes.ts
  getInventoryValue: () => apiRequest("GET", "/api/warehouse/inventory-value"),
  getReorderAlerts: () => apiRequest("GET", "/api/warehouse/reorder-alerts"),
  getPartRealStock: (partId: number) => apiRequest("GET", `/api/warehouse/parts/${partId}/real-stock`),
  getMostUsedParts: (params?: { limit?: number }) => {
    const url = params?.limit
      ? `/api/warehouse/most-used-parts?limit=${params.limit}`
      : "/api/warehouse/most-used-parts";
    return apiRequest("GET", url);
  },
  getStatistics: () => apiRequest("GET", "/api/warehouse/statistics"),
  getPartsBySupplier: () => apiRequest("GET", "/api/warehouse/parts-by-supplier"),

  // Mutations POST
  recordStockMovement: (data: any) => apiRequest("POST", "/api/warehouse/stock-movement", data),
};

// ============================================
// FUEL CARD API CALLS
// ============================================

export const fuelCardApi = {
  // Routes GET qui existent vraiment dans server/api/fuel-card.routes.ts
  getBalance: () => apiRequest("GET", "/api/fuel-card/balance"),
  getFullHistory: () => apiRequest("GET", "/api/fuel-card/history"),
  getVehicleStats: (vehicleId: string) =>
    apiRequest("GET", `/api/fuel-card/vehicle/${vehicleId}/stats`),
  getVehicleAnomalies: (vehicleId: string) =>
    apiRequest("GET", `/api/fuel-card/vehicle/${vehicleId}/anomalies`),
  getStatsByClient: () => apiRequest("GET", "/api/fuel-card/stats-by-client"),
  getMonthlyStats: () => apiRequest("GET", "/api/fuel-card/monthly-stats"),

  // Mutations POST
  rechargeCard: (data: any) => apiRequest("POST", "/api/fuel-card/recharge", data),
  recordConsumption: (data: any) => apiRequest("POST", "/api/fuel-card/consumption", data),
};

// ============================================
// VAT & BILLING API CALLS
// ============================================

export const billingApi = {
  getSuppliersSummary: () => apiRequest("GET", "/api/suppliers/summary"),
  getTopSuppliers: (params?: { limit?: number }) => {
    const url = params?.limit
      ? `/api/suppliers/top?limit=${params.limit}`
      : "/api/suppliers/top";
    return apiRequest("GET", url);
  },
  getSupplierInvoicesWithPayments: (supplierId: number) =>
    apiRequest("GET", `/api/suppliers/${supplierId}/invoices`),
  getInvoicesByFamily: () => apiRequest("GET", "/api/invoices/by-family"),
  getUnpaidInvoices: () => apiRequest("GET", "/api/invoices/unpaid"),
};

// ============================================
// VEHICLES API CALLS
// ============================================

export const vehiclesApi = {
  getById: (id: number) => apiRequest("GET", `/api/vehicles/${id}`),
  getByRegistration: (registration: string) =>
    apiRequest("GET", `/api/vehicles/registration/${registration}`),
  create: (data: any) => apiRequest("POST", "/api/vehicles", data),
  update: (id: number, data: any) => apiRequest("PATCH", `/api/vehicles/${id}`, data),
  delete: (id: number) => apiRequest("DELETE", `/api/vehicles/${id}`),
  getStats: () => apiRequest("GET", "/api/vehicles/stats"),
  getStatusSummary: () => apiRequest("GET", "/api/vehicles/status-summary"),
};

// ============================================
// MAINTENANCE API CALLS
// ============================================

export const maintenanceApi = {
  getWorkOrderById: (id: number) => apiRequest("GET", `/api/work-orders/${id}`),
  createWorkOrder: (data: any) => apiRequest("POST", "/api/work-orders", data),
  updateWorkOrder: (id: number, data: any) =>
    apiRequest("PATCH", `/api/work-orders/${id}`, data),
  deleteWorkOrder: (id: number) => apiRequest("DELETE", `/api/work-orders/${id}`),
  getPreventiveSchedules: () => apiRequest("GET", "/api/maintenance/preventive"),
  getFaultCatalog: () => apiRequest("GET", "/api/maintenance/faults"),
  getMaintenanceStats: () => apiRequest("GET", "/api/maintenance/stats"),
};

// ============================================
// ALERTS API CALLS
// ============================================

export const alertsApi = {
  getAll: () => apiRequest("GET", "/api/alerts"),
  getActive: () => apiRequest("GET", "/api/alerts/active"),
  getByType: (type: string) => apiRequest("GET", `/api/alerts/type/${type}`),
  markAsRead: (id: number) => apiRequest("PATCH", `/api/alerts/${id}/read`, {}),
  dismiss: (id: number) => apiRequest("DELETE", `/api/alerts/${id}`),
  getCount: () => apiRequest("GET", "/api/alerts/count"),
};

// ============================================
// USERS API CALLS
// ============================================

export const usersApi = {
  getAll: () => apiRequest("GET", "/api/users"),
  getById: (id: number) => apiRequest("GET", `/api/users/${id}`),
  create: (data: any) => apiRequest("POST", "/api/users", data),
  update: (id: number, data: any) => apiRequest("PATCH", `/api/users/${id}`, data),
  delete: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
};

// ============================================
// PARTS INVENTORY API CALLS
// ============================================

export const partsApi = {
  getById: (id: number) => apiRequest("GET", `/api/parts/${id}`),
  create: (data: any) => apiRequest("POST", "/api/parts", data),
  update: (id: number, data: any) => apiRequest("PATCH", `/api/parts/${id}`, data),
  delete: (id: number) => apiRequest("DELETE", `/api/parts/${id}`),
  getRequests: () => apiRequest("GET", "/api/parts/requests"),
  createRequest: (data: any) => apiRequest("POST", "/api/parts/requests", data),
};

// ============================================
// TIRES API CALLS
// ============================================

export const tiresApi = {
  getById: (id: number) => apiRequest("GET", `/api/tires/${id}`),
  create: (data: any) => apiRequest("POST", "/api/tires", data),
  update: (id: number, data: any) => apiRequest("PATCH", `/api/tires/${id}`, data),
  delete: (id: number) => apiRequest("DELETE", `/api/tires/${id}`),
  getRotations: () => apiRequest("GET", "/api/tires/rotations"),
  createRotation: (data: any) => apiRequest("POST", "/api/tires/rotations", data),
};