import { apiRequest } from "@/lib/queryClient";

export interface ExportOptions {
  year?: number;
  month?: number;
  client?: string;
  startDate?: string;
  endDate?: string;
}

export const exportsService = {
  async downloadInventory(): Promise<void> {
    const response = await apiRequest("GET", "/api/exports/inventory");
    if (!response.ok) {
      throw new Error("Failed to download inventory export");
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventaire_stock_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  async downloadFuel(options?: ExportOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.year) params.append("year", options.year.toString());
    if (options?.month) params.append("month", options.month.toString());
    
    const url = `/api/exports/fuel${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await apiRequest("GET", url);
    
    if (!response.ok) {
      throw new Error("Failed to download fuel export");
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    const filename = options?.year && options?.month 
      ? `carburant_${options.month}_${options.year}.xlsx`
      : `carburant_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  async downloadSupplierInvoices(): Promise<void> {
    const response = await apiRequest("GET", "/api/exports/supplier-invoices");
    if (!response.ok) {
      throw new Error("Failed to download supplier invoices export");
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `factures_fournisseurs_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  async downloadFuelStatistics(options?: ExportOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.year) params.append("year", options.year.toString());
    if (options?.month) params.append("month", options.month.toString());
    
    const url = `/api/exports/fuel-statistics${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await apiRequest("GET", url);
    
    if (!response.ok) {
      throw new Error("Failed to download fuel statistics export");
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    const filename = options?.year && options?.month 
      ? `stats_carburant_${options.month}_${options.year}.xlsx`
      : `stats_carburant_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  async downloadClientMissions(options?: ExportOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.client) params.append("client", options.client);
    if (options?.startDate) params.append("startDate", options.startDate);
    if (options?.endDate) params.append("endDate", options.endDate);
    
    const url = `/api/exports/client-missions${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await apiRequest("GET", url);
    
    if (!response.ok) {
      throw new Error("Failed to download client missions export");
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    const filename = options?.client 
      ? `missions_${options.client}_${new Date().toISOString().split('T')[0]}.xlsx`
      : `missions_tous_clients_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  async downloadClientInvoices(options?: ExportOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.client) params.append("client", options.client);
    if (options?.startDate) params.append("startDate", options.startDate);
    if (options?.endDate) params.append("endDate", options.endDate);
    
    const url = `/api/exports/client-invoices${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await apiRequest("GET", url);
    
    if (!response.ok) {
      throw new Error("Failed to download client invoices export");
    }
    
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    const filename = options?.client 
      ? `factures_${options.client}_${new Date().toISOString().split('T')[0]}.xlsx`
      : `factures_clients_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  getCurrentPeriod(): { year: number; month: number } {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
  },

  formatPeriod(year: number, month: number): string {
    const monthNames = [
      "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
      "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    ];
    return `${monthNames[month - 1]} ${year}`;
  },
};
