import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { maintenanceService } from "@/services/maintenanceService";

export function useMaintenance() {
  const workOrdersQuery = useQuery<any>({
    queryKey: ['/api/work-orders'],
    enabled: true,
  });

  const preventiveSchedulesQuery = useQuery<any>({
    queryKey: ['/api/maintenance/preventive'],
    enabled: true,
  });

  const faultCatalogQuery = useQuery<any>({
    queryKey: ['/api/maintenance/faults'],
    enabled: true,
  });

  const statsQuery = useQuery<any>({
    queryKey: ['/api/maintenance/stats'],
    enabled: true,
  });

  return {
    workOrders: {
      data: workOrdersQuery.data,
      isLoading: workOrdersQuery.isLoading,
      error: workOrdersQuery.error,
      refetch: workOrdersQuery.refetch,
    },
    preventiveSchedules: {
      data: preventiveSchedulesQuery.data,
      isLoading: preventiveSchedulesQuery.isLoading,
      error: preventiveSchedulesQuery.error,
      refetch: preventiveSchedulesQuery.refetch,
    },
    faultCatalog: {
      data: faultCatalogQuery.data,
      isLoading: faultCatalogQuery.isLoading,
      error: faultCatalogQuery.error,
      refetch: faultCatalogQuery.refetch,
    },
    stats: {
      data: statsQuery.data,
      isLoading: statsQuery.isLoading,
      error: statsQuery.error,
      refetch: statsQuery.refetch,
    },
    service: maintenanceService,
  };
}

export function useWorkOrder(id: number | null) {
  return useQuery<any>({
    queryKey: ['/api/work-orders', id],
    enabled: !!id && id > 0,
  });
}

export function useCreateWorkOrder() {
  return useMutation({
    mutationFn: async (workOrderData: any) => {
      const res = await apiRequest("POST", "/api/work-orders", workOrderData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance/stats'] });
    },
  });
}

export function useUpdateWorkOrder() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/work-orders/${id}`, data);
      return await res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance/stats'] });
    },
  });
}

export function useDeleteWorkOrder() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/work-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance/stats'] });
    },
  });
}
