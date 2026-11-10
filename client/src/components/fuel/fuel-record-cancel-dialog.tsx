import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { FUEL_RECORD_CANCEL_REASON_MIN_LENGTH } from "@shared/constants/fuel-record-cancel";

export type CancellableFuelRecord = { id: number; vehicleId?: number | null; missionId?: number | null };

const LIST_PREFIX = "/api/fuel-records";

function isFuelRecordKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && key[0].startsWith(LIST_PREFIX);
}

/** Couche 1 : le plein annulé sort aussitôt des listes en cache, sans attendre le refetch. */
function dropFromCachedLists(recordId: number): void {
  queryClient.setQueriesData<unknown>({ predicate: (query) => isFuelRecordKey(query.queryKey) }, (data) =>
    Array.isArray(data) ? data.filter((row) => !(row && typeof row === "object" && (row as { id?: unknown }).id === recordId)) : data,
  );
}

/** Couche 3 : détail, listes et écrans satellites (carte, statistiques, tableau de bord, budget de mission). */
function invalidateAfterCancel(record: CancellableFuelRecord): void {
  const { keys, prefixes } = satelliteTargetsOf("fuel_record_changed", {
    vehicleId: record.vehicleId ?? undefined,
    missionId: record.missionId ?? undefined,
  });
  const exact = new Set<string>([...keys, ...REALTIME_EVENTS.fuel_record_changed.invalidates, `${LIST_PREFIX}/${record.id}`]);
  for (const key of exact) queryClient.invalidateQueries({ queryKey: [key] });
  if (record.vehicleId) queryClient.invalidateQueries({ queryKey: [`${LIST_PREFIX}/vehicle/${record.vehicleId}`] });
  queryClient.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return typeof first === "string" && prefixes.some((prefix) => first.startsWith(prefix));
    },
  });
}

/**
 * Annulation tracée d'un plein validé. L'identifiant de la cible passe par les variables de la
 * mutation. L'événement temps réel `fuel_record_changed` est émis par le serveur (couche 2).
 */
export function FuelRecordCancelDialog({
  record,
  onClose,
  onCancelled,
}: {
  record: CancellableFuelRecord | null;
  onClose: () => void;
  onCancelled?: (record: CancellableFuelRecord) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (record) setReason("");
  }, [record?.id]);

  const mutation = useMutation({
    mutationFn: async ({ id, reason: motif }: { id: number; reason: string; record: CancellableFuelRecord }) => {
      await apiRequest("POST", `/api/fuel-records/${id}/cancel`, { reason: motif });
    },
    onSuccess: (_data, variables) => {
      dropFromCachedLists(variables.id);
      invalidateAfterCancel(variables.record);
      toast({ title: "Plein annulé", description: "Le plein est retiré des calculs. Saisissez-en un nouveau si besoin." });
      onClose();
      onCancelled?.(variables.record);
    },
    onError: (error: unknown) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Impossible d'annuler ce plein."), variant: "destructive" });
    },
  });
  const submit = useSingleFlightMutate(mutation.mutate);
  const trimmed = reason.trim();
  const valid = trimmed.length >= FUEL_RECORD_CANCEL_REASON_MIN_LENGTH;

  return (
    <Dialog open={Boolean(record)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler ce plein ?</DialogTitle>
          <DialogDescription>
            Un plein validé ne se modifie plus. L&apos;annulation le retire de l&apos;historique et des calculs, avec votre motif.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motif de l'annulation (obligatoire)"
          aria-label="Motif de l'annulation"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || !record || !valid}
            onClick={() => record && submit({ id: record.id, reason: trimmed, record })}
          >
            <Ban className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Annulation..." : "Annuler ce plein"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
