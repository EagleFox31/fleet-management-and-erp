import { apiRequest } from "@/lib/queryClient";

export interface ClientInvoice {
  id: number;
  missionId: number | null;
  clientName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountHT: string;
  vatAmount: string;
  amountTTC: string;
  balance: string;
  status: string;
  items: InvoiceItem[];
  notes: string | null;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface BillingStatistics {
  totalInvoices: number;
  totalAmountHT: number;
  totalVAT: number;
  totalAmountTTC: number;
  totalPaid: number;
  totalPending: number;
  totalOverdue: number;
}

export interface ClientBillingSummary {
  clientName: string;
  totalInvoices: number;
  totalAmountHT: number;
  totalVAT: number;
  totalAmountTTC: number;
  totalPaid: number;
  totalPending: number;
}

export interface InvoiceGenerationData {
  missionId: number;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  includeVAT: boolean;
  items?: InvoiceItem[];
  notes?: string;
}

export interface PaymentData {
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}

export interface PaymentResult {
  newBalance: number;
  status: string;
}

export const clientBillingService = {
  async getStatistics(): Promise<BillingStatistics> {
    const response = await apiRequest("GET", "/api/billing/statistics");
    if (!response.ok) {
      throw new Error("Failed to fetch billing statistics");
    }
    return await response.json();
  },

  async getClientSummary(): Promise<ClientBillingSummary[]> {
    const response = await apiRequest("GET", "/api/billing/client-summary");
    if (!response.ok) {
      throw new Error("Failed to fetch client summary");
    }
    return await response.json();
  },

  async getPendingInvoices(): Promise<ClientInvoice[]> {
    const response = await apiRequest("GET", "/api/billing/invoices/pending");
    if (!response.ok) {
      throw new Error("Failed to fetch pending invoices");
    }
    return await response.json();
  },

  async getOverdueInvoices(): Promise<ClientInvoice[]> {
    const response = await apiRequest("GET", "/api/billing/invoices/overdue");
    if (!response.ok) {
      throw new Error("Failed to fetch overdue invoices");
    }
    return await response.json();
  },

  async generateInvoice(data: InvoiceGenerationData): Promise<ClientInvoice> {
    const response = await apiRequest("POST", "/api/billing/invoices/generate", data);
    if (!response.ok) {
      throw new Error("Failed to generate invoice");
    }
    return await response.json();
  },

  async recordPayment(invoiceId: number, data: PaymentData): Promise<PaymentResult> {
    const response = await apiRequest("PATCH", `/api/billing/invoices/${invoiceId}/payment`, data);
    if (!response.ok) {
      throw new Error("Failed to record payment");
    }
    return await response.json();
  },

  calculateVAT(amountHT: number, rate: number = 0.1925): number {
    return amountHT * rate;
  },

  calculateTTC(amountHT: number, vatRate: number = 0.1925): number {
    return amountHT * (1 + vatRate);
  },

  formatCurrency(amount: number | string): string {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  },

  formatDate(date: string | Date): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat('fr-FR').format(d);
  },

  getStatusBadgeColor(status: string): string {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "overdue":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "partial":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  },

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      paid: "Payée",
      pending: "En attente",
      overdue: "En retard",
      partial: "Partiel",
    };
    return labels[status] || status;
  },
};
