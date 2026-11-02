import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingError } from "@/components/ui/loading-error";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FUEL_ANOMALIES_PATH, FUEL_ANOMALIES_SUMMARY_PATH, fuelAnomaliesSummarySchema } from "@shared/contracts/fuel-anomalies";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { VEHICLE_TANK_CAPACITY_MAX_L, VEHICLE_TANK_CAPACITY_MESSAGE, VEHICLE_TANK_CAPACITY_MIN_L, vehicleTankCapacitySchema } from "@shared/schema";

type Target = { id: number; label: string };

/**
 * Véhicules sans capacité de réservoir (FUEL3) : la règle « Plein supérieur au réservoir » y est
 * muette. `canEdit` (logistique, chef d'atelier, admin) ouvre la saisie, qui ne porte que
 * `tankCapacityL` : c'est le seul champ que la logistique peut envoyer au PATCH véhicule.
 */
export function TankCapacityPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const summary = useContractQuery(FUEL_ANOMALIES_SUMMARY_PATH, fuelAnomaliesSummarySchema);
  const [listOpen, setListOpen] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ id, tankCapacityL }: { id: number; tankCapacityL: number }) =>
      (await apiRequest("PATCH", `/api/vehicles/${id}`, { tankCapacityL })).json(),
    onSuccess: () => {
      setTarget(null);
      // Couche 3 : mêmes clés que l'événement temps réel (compteur, anomalies, véhicules).
      for (const key of [...REALTIME_EVENTS.vehicle_tank_capacity_changed.invalidates, FUEL_ANOMALIES_PATH]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: "Capacité enregistrée" });
    },
    onError: (err) => toast({ title: "Capacité non enregistrée", description: userMessageOf(err), variant: "destructive" }),
  });
  const save = useSingleFlightMutate(mutation.mutate);

  if (summary.isError) {
    return <LoadingError isLoading={false} error={summary.error} onRetry={() => summary.refetch()} />;
  }
  if (!summary.data || summary.data.vehiclesWithoutTankCapacity === 0) return null;
  const { vehiclesWithoutTankCapacity: count, vehicles } = summary.data;

  const submit = () => {
    if (!target) return;
    const parsed = vehicleTankCapacitySchema.safeParse(value);
    if (!parsed.success || parsed.data == null) {
      setError(VEHICLE_TANK_CAPACITY_MESSAGE);
      return;
    }
    save({ id: target.id, tankCapacityL: parsed.data });
  };

  return (
    <Card data-testid="tank-capacity-panel">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span data-testid="tank-capacity-missing-count">
            {count} véhicule{count > 1 ? "s" : ""} sans capacité de réservoir : la règle « Plein supérieur au réservoir » ne les contrôle pas.
          </span>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setListOpen((o) => !o)} data-testid="tank-capacity-toggle">
            {listOpen ? "Masquer" : "Compléter"}
          </Button>
        )}
      </CardContent>
      {canEdit && listOpen && (
        <CardContent className="pt-0">
          <ul className="divide-y rounded-md border" data-testid="tank-capacity-list">
            {vehicles.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{v.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTarget(v);
                    setValue("");
                    setError(null);
                  }}
                  data-testid={`tank-capacity-edit-${v.id}`}
                >
                  Saisir la capacité
                </Button>
              </li>
            ))}
          </ul>
          {count > vehicles.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {vehicles.length} premiers véhicules affichés sur {count}.
            </p>
          )}
        </CardContent>
      )}

      <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capacité des réservoirs</DialogTitle>
            <DialogDescription>{target?.label} : capacité totale, tous réservoirs confondus.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tank-capacity-input">Capacité (L)</Label>
            <Input
              id="tank-capacity-input"
              type="number"
              inputMode="decimal"
              min={VEHICLE_TANK_CAPACITY_MIN_L}
              max={VEHICLE_TANK_CAPACITY_MAX_L}
              step="0.1"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              data-testid="tank-capacity-input"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Annuler</Button>
            <Button disabled={mutation.isPending} onClick={submit} data-testid="tank-capacity-save">
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
