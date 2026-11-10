import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { invalidateVehicleLifecycleQueries } from "@/lib/vehicle-lifecycle-cache";
import { vehiclesService } from "@/services/vehiclesService";
import { useAllVehicles } from "@/hooks/use-all-vehicles";

export function useVehicles() {
  // Flotte complète : `["/api/vehicles"]` sans `limit` ne rendait que 10 véhicules.
  const allVehiclesQuery = useAllVehicles();

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

/** Véhicule retiré de la flotte, tel que renvoyé par `GET /api/vehicles/archived` (admin). */
export type RetiredVehicle = {
  id: number;
  registration_number: string;
  brand: string | null;
  model: string | null;
  status: string | null;
  archived_at: string;
};

export const RETIRED_VEHICLES_KEY = "/api/vehicles/archived";

/**
 * Remise d'un véhicule retiré dans la flotte (admin). L'id passe par les variables (AGENTS.md §10).
 * Couche 1 : la ligne quitte la liste des retirés dès le succès ; couche 3 : resync partagé avec la
 * suppression (`invalidateVehicleLifecycleQueries`) ; la couche 2 est la trame `vehicle_restored`.
 */
export function useRestoreVehicle(callbacks: {
  onSuccess?: (response: RestoreVehicleResponse, variables: { id: number }) => void;
  onError?: (error: unknown) => void;
} = {}) {
  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await apiRequest("POST", `/api/vehicles/${id}/restore`);
      return (await res.json()) as RestoreVehicleResponse;
    },
    onSuccess: (response, variables) => {
      queryClient.setQueryData<RetiredVehicle[]>([RETIRED_VEHICLES_KEY], (rows) => rows?.filter((row) => row.id !== variables.id));
      invalidateVehicleLifecycleQueries(queryClient, "vehicle_restored", variables.id);
      callbacks.onSuccess?.(response, variables);
    },
    onError: (error) => callbacks.onError?.(error),
  });
}

export type RestoreVehicleResponse = { message: string; result: { restored: boolean } };

export function useDeleteVehicle() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/vehicles/${id}`);
    },
    onSuccess: (_, id) => {
      invalidateVehicleLifecycleQueries(queryClient, "vehicle_deleted", id);
    },
  });
}
