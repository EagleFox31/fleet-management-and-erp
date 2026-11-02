import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingError } from "@/components/ui/loading-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatFuelAnomalyFigures } from "@/lib/fuel-anomaly-display";
import { TankCapacityPanel } from "./tank-capacity-panel";
import { formatDate } from "@/lib/utils";
import { getFuelAnomalyRuleLabel } from "@shared/constants/fuel-anomaly-rules";
import {
  FUEL_ANOMALIES_PATH,
  FUEL_ANOMALY_STATUSES,
  fuelAnomaliesResponseSchema,
  fuelAnomalyPath,
  fuelAnomalyResolutionSchema,
  type FuelAnomaly,
  type FuelAnomalyStatus,
  type UpdateFuelAnomalyRequest,
} from "@shared/contracts/fuel-anomalies";

/** Le badge décrit l'anomalie (AGENTS.md §1). */
export const FUEL_ANOMALY_STATUS_LABELS: Record<FuelAnomalyStatus, string> = {
  open: "Ouverte",
  justified: "Justifiée",
  confirmed: "Confirmée",
};

/**
 * Anomalies carburant (P-18). `readOnly` pour qui consulte sans traiter (chef d'atelier,
 * direction : hors `FUEL_WRITE_ROLES`) : la colonne Traiter n'existe pas pour eux.
 */
export function FuelAnomaliesTable({ readOnly = false, canEditTankCapacity = false }: { readOnly?: boolean; canEditTankCapacity?: boolean }) {
  const { toast } = useToast();
  const anomalies = useContractQuery(FUEL_ANOMALIES_PATH, fuelAnomaliesResponseSchema);
  const [editing, setEditing] = useState<FuelAnomaly | null>(null);
  const [decision, setDecision] = useState<FuelAnomalyStatus>("justified");
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: async ({ key, body }: { key: string; body: UpdateFuelAnomalyRequest }) =>
      fuelAnomalyResolutionSchema.parse(await (await apiRequest("PATCH", fuelAnomalyPath(key), body)).json()),
    onSuccess: () => {
      setEditing(null);
      // Couche 3 : liste des anomalies et détection par véhicule (useFuelCard).
      for (const key of [FUEL_ANOMALIES_PATH, "/api/fuel-card/vehicle"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: "Anomalie traitée" });
    },
    onError: (error) => toast({ title: "Anomalie non traitée", description: userMessageOf(error), variant: "destructive" }),
  });
  const resolve = useSingleFlightMutate(mutation.mutate);

  const startEditing = (a: FuelAnomaly) => {
    setEditing(a);
    setDecision(a.status === "open" ? "justified" : a.status);
    setComment(a.comment ?? "");
  };

  const columns: PremiumDataTableColumn<FuelAnomaly>[] = [
    { id: "date", header: "Date", cell: (a) => (a.date ? formatDate(a.date) : "—") },
    { id: "vehicle", header: "Véhicule", cell: (a) => a.vehicleLabel ?? `#${a.vehicleId}` },
    {
      id: "rule",
      header: "Règle",
      cell: (a) => <span data-testid={`fuel-anomaly-rule-${a.anomalyKey}`}>{getFuelAnomalyRuleLabel(a.rule)}</span>,
    },
    {
      id: "value",
      header: "Constaté",
      align: "right",
      cell: (a) => <span data-testid={`fuel-anomaly-value-${a.anomalyKey}`}>{formatFuelAnomalyFigures(a).value}</span>,
    },
    {
      id: "reference",
      header: "Référence",
      cell: (a) => (
        <span data-testid={`fuel-anomaly-reference-${a.anomalyKey}`}>{formatFuelAnomalyFigures(a).reference ?? "—"}</span>
      ),
    },
    {
      id: "status",
      header: "Statut",
      cell: (a) => (
        <Badge variant={a.status === "open" ? "destructive" : "secondary"}>{FUEL_ANOMALY_STATUS_LABELS[a.status]}</Badge>
      ),
    },
    { id: "comment", header: "Commentaire", cell: (a) => a.comment ?? "—" },
  ];
  if (!readOnly) {
    columns.push({
      id: "action",
      header: "",
      align: "right",
      cell: (a) => (
        <Button size="sm" variant="outline" onClick={() => startEditing(a)} data-testid={`fuel-anomaly-resolve-${a.anomalyKey}`}>
          <ClipboardCheck className="mr-1 h-4 w-4" aria-hidden="true" />
          Traiter
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-4" data-testid="fuel-anomalies">
      <HeaderCard moduleLabel="Carburant" title="Anomalies carburant" icon={<AlertTriangle className="h-5 w-5" />} />
      <TankCapacityPanel canEdit={canEditTankCapacity} />
      {anomalies.isError ? (
        <LoadingError isLoading={false} error={anomalies.error} onRetry={() => anomalies.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={anomalies.data ?? []}
          rowKey={(a) => a.anomalyKey}
          emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune anomalie détectée.</p>}
        />
      )}

      <Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Traiter l'anomalie</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={decision} onValueChange={(value) => setDecision(value as FuelAnomalyStatus)}>
              <SelectTrigger aria-label="Décision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FUEL_ANOMALY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{FUEL_ANOMALY_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={comment}
              maxLength={1000}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire (facultatif)"
              aria-label="Commentaire"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
            <Button
              disabled={mutation.isPending}
              onClick={() =>
                editing && resolve({ key: editing.anomalyKey, body: { status: decision, comment: comment.trim() || undefined } })
              }
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
