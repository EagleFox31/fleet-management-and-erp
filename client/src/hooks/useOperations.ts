import { useQuery, useMutation } from "@tanstack/react-query";
import { operationsService, type MissionFormData } from "@/services/operationsService";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";

export function useOperations() {
  const { toast } = useToast();
  const liveQueryConfig = {
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  } as const;

  const statsByClient = useQuery<any>({
    queryKey: ["/api/operations/stats/by-client"],
    queryFn: () => operationsService.getStatsByClient(),
    ...liveQueryConfig,
  });

  const statsByDestination = useQuery<any>({
    queryKey: ["/api/operations/stats/by-destination"],
    queryFn: () => operationsService.getStatsByDestination(),
    ...liveQueryConfig,
  });

  const upcomingMissions = useQuery<any>({
    queryKey: ["/api/operations/missions/upcoming"],
    queryFn: () => operationsService.getUpcomingMissions(),
    ...liveQueryConfig,
  });

  const activeMissions = useQuery<any>({
    queryKey: ["/api/operations/missions/active"],
    queryFn: () => operationsService.getActiveMissions(),
    ...liveQueryConfig,
  });

  const createMissionMutation = useMutation({
    mutationFn: (data: MissionFormData) => operationsService.createMissionFromFuel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operations"] });
      toast({
        title: "Mission créée",
        description: "La mission a été créée avec succès",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de créer la mission."),
        variant: "destructive",
      });
    },
  });

  const completeMissionMutation = useMutation({
    mutationFn: ({ missionId, data }: { missionId: number; data: any }) =>
      operationsService.completeMission(missionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operations"] });
      toast({
        title: "Mission terminée",
        description: "La mission a été marquée comme terminée",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de terminer la mission."),
        variant: "destructive",
      });
    },
  });

  return {
    statsByClient,
    statsByDestination,
    upcomingMissions,
    activeMissions,
    createMission: createMissionMutation.mutate,
    isCreatingMission: createMissionMutation.isPending,
    completeMission: completeMissionMutation.mutate,
    isCompletingMission: completeMissionMutation.isPending,
  };
}

export function useMissionsByClient(clientName: string, filters?: {
  startDate?: string;
  endDate?: string;
}) {
  return useQuery<any>({
    queryKey: ["/api/operations/missions/by-client", clientName, filters],
    queryFn: () => operationsService.getMissionsByClient(clientName, filters),
    enabled: !!clientName,
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

export function useMissionCosts(missionId: number) {
  return useQuery<any>({
    queryKey: ["/api/operations", missionId, "costs"],
    queryFn: () => operationsService.getMissionCosts(missionId),
    enabled: !!missionId,
  });
}
