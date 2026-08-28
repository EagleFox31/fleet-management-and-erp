import { billingApi } from "@/lib/api-calls";

export interface SupplierSummary {
  supplierId: number;
  supplierName: string;
  totalInvoices: number;
  totalAmount: number;
  totalPaid: number;
  balance: number;
  families: Array<{
    family: string;
    amount: number;
    invoiceCount: number;
  }>;
}

export interface TopSupplier {
  supplierId: number;
  supplierName: string;
  totalAmount: number;
  invoiceCount: number;
  paidAmount: number;
  unpaidAmount: number;
}

export interface SupplierInvoiceDetail {
  invoiceId: number;
  invoiceNumber: string;
  date: string;
  amount: number;
  vatAmount: number;
  totalWithVAT: number;
  paid: number;
  balance: number;
  family: string;
}

export interface InvoicesByFamily {
  family: string;
  invoiceCount: number;
  totalAmount: number;
  totalVAT: number;
  totalWithVAT: number;
}

export interface UnpaidInvoice {
  invoiceId: number;
  invoiceNumber: string;
  supplierId: number;
  supplierName: string;
  date: string;
  amount: number;
  balance: number;
  daysOverdue: number;
}

export interface MonthlyBillingStats {
  month: string;
  invoiceCount: number;
  totalAmount: number;
  totalVAT: number;
  totalPaid: number;
  unpaidBalance: number;
}

export const billingService = {
  async getSuppliersSummary(): Promise<SupplierSummary[]> {
    const response = await billingApi.getSuppliersSummary();
    const data = await response.json();
    return data;
  },

  async getTopSuppliers(limit?: number): Promise<TopSupplier[]> {
    const response = await billingApi.getTopSuppliers(limit ? { limit } : undefined);
    const data = await response.json();
    return data;
  },

  async getSupplierInvoicesWithPayments(supplierId: number): Promise<{
    summary: {
      totalInvoices: number;
      totalAmount: number;
      totalPaid: number;
      balance: number;
    };
    invoices: SupplierInvoiceDetail[];
  }> {
    const response = await billingApi.getSupplierInvoicesWithPayments(supplierId);
    const data = await response.json();
    return data;
  },

  async getInvoicesByFamily(): Promise<InvoicesByFamily[]> {
    const response = await billingApi.getInvoicesByFamily();
    const data = await response.json();
    return data;
  },

  async getUnpaidInvoices(): Promise<UnpaidInvoice[]> {
    const response = await billingApi.getUnpaidInvoices();
    const data = await response.json();
    return data;
  },

  async getMonthlyStats(): Promise<MonthlyBillingStats[]> {
    const response = await billingApi.getMonthlyStats();
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

  calculateVATAmount(amount: number, vatRate: number = 19.25): number {
    return amount * (vatRate / 100);
  },

  calculateTotalWithVAT(amount: number, vatRate: number = 19.25): number {
    return amount + this.calculateVATAmount(amount, vatRate);
  },

  calculatePaymentPercentage(paid: number, total: number): number {
    if (total === 0) return 0;
    return (paid / total) * 100;
  },

  getPaymentStatus(balance: number): 'paid' | 'partial' | 'unpaid' {
    if (balance === 0) return 'paid';
    if (balance > 0) return 'unpaid';
    return 'partial';
  },

  getPaymentStatusColor(status: 'paid' | 'partial' | 'unpaid'): string {
    switch (status) {
      case 'paid':
        return 'text-green-600 dark:text-green-400';
      case 'partial':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'unpaid':
        return 'text-red-600 dark:text-red-400';
    }
  },

  calculateOverdueDays(invoiceDate: string): number {
    const today = new Date();
    const invoice = new Date(invoiceDate);
    const diffTime = Math.abs(today.getTime() - invoice.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  },
};
