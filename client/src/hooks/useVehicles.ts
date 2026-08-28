import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { vehiclesService } from "@/services/vehiclesService";

export function useVehicles() {
  const allVehiclesQuery = useQuery<any>({
    queryKey: ['/api/vehicles'],
    enabled: true,
  });

  const statsQuery = useQuery<any>({
    queryKey: ['/api/vehicles/stats'],
    enabled: true,
  });

  const statusSummaryQuery = useQuery<any>({
    queryKey: ['/api/vehicles/status-summary'],
    enabled: true,
  });

  return {
    vehicles: {
      data: allVehiclesQuery.data,
      isLoading: allVehiclesQuery.isLoading,
      error: allVehiclesQuery.error,
      refetch: allVehiclesQuery.refetch,
    },
    stats: {
      data: statsQuery.data,
      isLoading: statsQuery.isLoading,
      error: statsQuery.error,
      refetch: statsQuery.refetch,
    },
    statusSummary: {
      data: statusSummaryQuery.data,
      isLoading: statusSummaryQuery.isLoading,
      error: statusSummaryQuery.error,
      refetch: statusSummaryQuery.refetch,
    },
    service: vehiclesService,
  };
}

export function useVehicle(id: number | null) {
  return useQuery<any>({
    queryKey: ['/api/vehicles', id],
    enabled: !!id && id > 0,
  });
}

export function useVehicleByRegistration(registration: string | null) {
  return useQuery<any>({
    queryKey: ['/api/vehicles/registration', registration],
    enabled: !!registration,
  });
}

export function useCreateVehicle() {
  return useMutation({
    mutationFn: async (vehicleData: any) => {
      const res = await apiRequest("POST", "/api/vehicles", vehicleData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
    },
  });
}

export function useUpdateVehicle() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/vehicles/${id}`, data);
      return await res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles', variables.id] });
    },
  });
}

export function useDeleteVehicle() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/vehicles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
    },
  });
}
