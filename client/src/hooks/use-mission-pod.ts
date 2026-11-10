import { useMutation, useQuery } from "@tanstack/react-query";
import type { MissionPodUploadResponse } from "@shared/contracts/mission-pod";
import { queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { applyPodUploaded, podFilesKey, uploadMissionPod, type PodReadState } from "@/lib/mission-pod";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";

export type PodFileRow = {
  id: number;
  originalName: string | null;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName?: string | null;
};

/** Lecture des POD d'une mission. `failed` : en erreur et sans données, donc « on ne sait pas », pas « zéro ». */
export function useMissionPodFiles(missionId: number | string | undefined) {
  const query = useQuery<{ files: PodFileRow[] }>({
    queryKey: [`/api/missions/${missionId}/pod-files`], // gabarit littéral : repéré par le garde-fou de realtime-satellites
    enabled: !!missionId,
  });
  const failed = query.data === undefined && !!query.error;
  const read: PodReadState = { count: query.data?.files.length, failed };
  return { ...query, files: query.data?.files ?? [], failed, read };
}

/** Dépôt de POD : l'id de la mission passe par les variables, jamais par un état lu dans la `mutationFn`. */
export function useMissionPodUpload(onDone?: () => void) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: ({ missionId, files }: { missionId: number; files: File[] }) => uploadMissionPod(missionId, files),
    onSuccess: (result: MissionPodUploadResponse, { missionId }) => {
      applyPodUploaded(queryClient, missionId, result);
      const added = result.files.length - result.duplicates;
      const plural = (n: number) => (n > 1 ? "s" : "");
      toast({
        title: "POD enregistré",
        description:
          result.duplicates > 0
            ? `${result.duplicates} fichier${plural(result.duplicates)} déjà enregistré${plural(result.duplicates)}, ignoré${plural(result.duplicates)}.`
            : `${added} fichier${plural(added)} ajouté${plural(added)}.`,
      });
      onDone?.();
    },
    onError: (error: unknown, { missionId }) => {
      // Un échec réseau peut cacher un dépôt abouti : relire la liste.
      void queryClient.invalidateQueries({ queryKey: [podFilesKey(missionId)] });
      toast({ variant: "destructive", title: "Dépôt du POD impossible", description: userMessageOf(error, "Le dépôt du POD a échoué.") });
    },
  });
  const submit = useSingleFlightMutate(mutation.mutate);
  return { submit, isPending: mutation.isPending };
}
