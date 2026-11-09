import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fuelCardService } from "@/services/fuelCardService";

export function useFuelCard() {
  // Source de vérité carte carburant: endpoints /api/fuel-card/*
  const balanceQuery = useQuery<any>({
    queryKey: ['/api/fuel-card/balance'],
    enabled: true,
  });

  const fullHistoryQuery = useQuery<any>({
    queryKey: ['/api/fuel-card/history'],
    enabled: true,
  });

  const statsByClientQuery = useQuery<any>({
    queryKey: ['/api/fuel-card/stats-by-client'],
    enabled: true,
  });

  const monthlyStatsQuery = useQuery<any>({
    queryKey: ['/api/fuel-card/monthly-stats'],
    enabled: true,
  });

  return {
    balance: {
      data: balanceQuery.data,
      isLoading: balanceQuery.isLoading,
      error: balanceQuery.error,
      // Lecture en échec sans donnée : l'écran affiche « Indisponible », jamais 0.
      failed: balanceQuery.data === undefined && !!balanceQuery.error,
      refetch: balanceQuery.refetch,
    },
    fullHistory: {
      data: fullHistoryQuery.data,
      isLoading: fullHistoryQuery.isLoading,
      error: fullHistoryQuery.error,
      refetch: fullHistoryQuery.refetch,
    },
    statsByClient: {
      data: statsByClientQuery.data,
      isLoading: statsByClientQuery.isLoading,
      error: statsByClientQuery.error,
      refetch: statsByClientQuery.refetch,
    },
    monthlyStats: {
      data: monthlyStatsQuery.data,
      isLoading: monthlyStatsQuery.isLoading,
      error: monthlyStatsQuery.error,
      refetch: monthlyStatsQuery.refetch,
    },
    service: fuelCardService,
  };
}

export function useVehicleFuelStats(vehicleId: string | null) {
  return useQuery<any>({
    queryKey: ['/api/fuel-card/vehicle', vehicleId, 'stats'],
    enabled: !!vehicleId,
  });
}

export function useVehicleFuelAnomalies(vehicleId: string | null) {
  return useQuery<any>({
    queryKey: ['/api/fuel-card/vehicle', vehicleId, 'anomalies'],
    enabled: !!vehicleId,
  });
}

export function useFuelCardRefresh() {
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/fuel-card'] });
  };

  const refreshBalance = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/fuel-card/balance'] });
  };

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/fuel-card/history'] });
  };

  return {
    refreshAll,
    refreshBalance,
    refreshHistory,
  };
}
