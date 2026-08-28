import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { alertsService } from "@/services/alertsService";

export function useAlerts() {
  const allAlertsQuery = useQuery<any>({
    queryKey: ['/api/alerts'],
    enabled: true,
  });

  const activeAlertsQuery = useQuery<any>({
    queryKey: ['/api/alerts/active'],
    enabled: true,
  });

  const alertCountQuery = useQuery<any>({
    queryKey: ['/api/alerts/count'],
    enabled: true,
  });

  return {
    all: {
      data: allAlertsQuery.data,
      isLoading: allAlertsQuery.isLoading,
      error: allAlertsQuery.error,
      refetch: allAlertsQuery.refetch,
    },
    active: {
      data: activeAlertsQuery.data,
      isLoading: activeAlertsQuery.isLoading,
      error: activeAlertsQuery.error,
      refetch: activeAlertsQuery.refetch,
    },
    count: {
      data: alertCountQuery.data,
      isLoading: alertCountQuery.isLoading,
      error: alertCountQuery.error,
      refetch: alertCountQuery.refetch,
    },
    service: alertsService,
  };
}

export function useAlertsByType(type: string | null) {
  return useQuery<any>({
    queryKey: ['/api/alerts/type', type],
    enabled: !!type,
  });
}

export function useMarkAlertAsRead() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/alerts/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.setQueryData<any>(["/api/alerts/count"], (currentCount) => {
        if (!currentCount || typeof currentCount !== "object") return currentCount;
        const currentUnread = Number(currentCount.unread || 0);
        return {
          ...currentCount,
          unread: Math.max(0, currentUnread - 1),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/unread'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    },
  });
}

export function useDismissAlert() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/unread'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/active'] });
      queryClient.invalidateQueries({ queryKey: ['/api/alerts/count'] });
    },
  });
}
