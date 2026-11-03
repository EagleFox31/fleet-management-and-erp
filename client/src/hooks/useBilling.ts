import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { billingService } from "@/services/billingService";

export function useBilling() {
  const suppliersSummaryQuery = useQuery<any>({
    queryKey: ['/api/suppliers/summary'],
    enabled: true,
  });

  const invoicesByFamilyQuery = useQuery<any>({
    queryKey: ['/api/invoices/by-family'],
    enabled: true,
  });

  const unpaidInvoicesQuery = useQuery<any>({
    queryKey: ['/api/invoices/unpaid'],
    enabled: true,
  });

  return {
    suppliersSummary: {
      data: suppliersSummaryQuery.data,
      isLoading: suppliersSummaryQuery.isLoading,
      error: suppliersSummaryQuery.error,
      refetch: suppliersSummaryQuery.refetch,
    },
    invoicesByFamily: {
      data: invoicesByFamilyQuery.data,
      isLoading: invoicesByFamilyQuery.isLoading,
      error: invoicesByFamilyQuery.error,
      refetch: invoicesByFamilyQuery.refetch,
    },
    unpaidInvoices: {
      data: unpaidInvoicesQuery.data,
      isLoading: unpaidInvoicesQuery.isLoading,
      error: unpaidInvoicesQuery.error,
      refetch: unpaidInvoicesQuery.refetch,
    },
    service: billingService,
  };
}

export function useTopSuppliers(limit?: number) {
  return useQuery<any>({
    queryKey: ['/api/suppliers/top', { limit }],
    enabled: true,
  });
}

export function useSupplierInvoices(supplierId: number | null) {
  return useQuery<any>({
    queryKey: ['/api/suppliers', supplierId, 'invoices'],
    enabled: !!supplierId && supplierId > 0,
  });
}

export function useBillingRefresh() {
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
  };

  const refreshSuppliers = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
  };

  const refreshInvoices = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
  };

  return {
    refreshAll,
    refreshSuppliers,
    refreshInvoices,
  };
}
