import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { getTireMountPositionLabel } from "@shared/constants/tires";
import {
  TIRE_REMOVAL_DESTINATION_LABELS,
  TIRE_REMOVAL_DESTINATIONS,
  TIRE_SCRAP_REASON_LABELS,
  TIRE_SCRAP_REASONS,
  type TireRemoval,
  type TireRemovalDestination,
  type TireScrapReason,
} from "@shared/constants/tire-removal";
import { Loader2, PackageOpen } from "lucide-react";

export interface MountedTireToRemove {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  position: string;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  installationMileage: number;
}

interface VehicleTireRemoveDialogProps {
  mountedTire: MountedTireToRemove | null;
  onOpenChange: (open: boolean) => void;
}

const DESTINATION_HINTS: Record<TireRemovalDestination, string> = {
  stock: "Pneu réutilisable : il retourne au magasin en usagé, à part du neuf de sa référence.",
  scrap: "Pneu hors d'usage : il ne revient pas en stock.",
};

/** Démontage atelier : la destination du pneu (stock ou rebut) est obligatoire. */
export function VehicleTireRemoveDialog({ mountedTire, onOpenChange }: VehicleTireRemoveDialogProps) {
  const { toast } = useToast();
  const [destination, setDestination] = useState<TireRemovalDestination | "">("");
  const [scrapReason, setScrapReason] = useState<TireScrapReason | "">("");
  const [removalMileage, setRemovalMileage] = useState("");
  const [removalReason, setRemovalReason] = useState("");

  useEffect(() => {
    if (!mountedTire) return;
    setDestination("");
    setScrapReason("");
    setRemovalMileage("");
    setRemovalReason("");
  }, [mountedTire?.id]);

  const removeMutation = useMutation({
    mutationFn: async ({ id, removal }: { id: number; removal: TireRemoval }) => {
      const response = await apiRequest("PATCH", `/api/vehicle-tires/${id}/remove`, removal);
      return response.json();
    },
    onSuccess: (_data, { removal }) => {
      toast({
        title: "Pneu démonté",
        description:
          removal.destination === "stock"
            ? "Le pneu est revenu au magasin, en stock usagé."
            : "Le pneu est mis au rebut, le stock est inchangé.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-tires"] });
      if (mountedTire) {
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${mountedTire.vehicleId}/tires`] });
      }
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Démontage impossible",
        description: userMessageOf(error, "Le démontage n'a pas pu être enregistré."),
      });
    },
  });
  const submitRemoval = useSingleFlightMutate(removeMutation.mutate);

  const mileage = removalMileage.trim() === "" ? undefined : Number(removalMileage);
  const mileageInvalid =
    mileage !== undefined && (!Number.isInteger(mileage) || mileage < (mountedTire?.installationMileage ?? 0));
  const canSubmit =
    !!mountedTire && destination !== "" && (destination === "stock" || scrapReason !== "") && !mileageInvalid;

  const submit = () => {
    if (!mountedTire || !canSubmit) return;
    submitRemoval({
      id: mountedTire.id,
      removal: {
        destination: destination as TireRemovalDestination,
        scrapReason: destination === "scrap" ? (scrapReason as TireScrapReason) : undefined,
        removalMileage: mileage,
        removalReason: removalReason.trim() || undefined,
      },
    });
  };

  return (
    <Dialog open={mountedTire !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-amber-600" />
            Démonter le pneu
          </DialogTitle>
          <DialogDescription className="text-left pt-1">
            {mountedTire ? (
              <>
                <span className="font-medium text-foreground">{mountedTire.vehicleRegistration}</span> ·{" "}
                {getTireMountPositionLabel(mountedTire.position)} · {mountedTire.tireBrand} {mountedTire.tireModel}{" "}
                {mountedTire.tireSize}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>Destination du pneu</Label>
            <RadioGroup
              value={destination}
              onValueChange={(value) => setDestination(value as TireRemovalDestination)}
              className="grid gap-2"
            >
              {TIRE_REMOVAL_DESTINATIONS.map((value) => (
                <label
                  key={value}
                  htmlFor={`remove-destination-${value}`}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary"
                >
                  <RadioGroupItem id={`remove-destination-${value}`} value={value} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{TIRE_REMOVAL_DESTINATION_LABELS[value]}</span>
                    <span className="block text-xs text-muted-foreground">{DESTINATION_HINTS[value]}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {destination === "scrap" && (
            <div className="grid gap-2">
              <Label htmlFor="remove-scrap-reason">Motif de mise au rebut</Label>
              <Select value={scrapReason} onValueChange={(value) => setScrapReason(value as TireScrapReason)}>
                <SelectTrigger id="remove-scrap-reason">
                  <SelectValue placeholder="Choisir un motif" />
                </SelectTrigger>
                <SelectContent>
                  {TIRE_SCRAP_REASONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TIRE_SCRAP_REASON_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="remove-km">Kilométrage au démontage</Label>
            <Input
              id="remove-km"
              type="number"
              min={mountedTire?.installationMileage ?? 0}
              placeholder="Optionnel"
              value={removalMileage}
              onChange={(e) => setRemovalMileage(e.target.value)}
            />
            {mileageInvalid ? (
              <p className="text-xs text-destructive">
                Au moins {mountedTire?.installationMileage.toLocaleString("fr-FR")} km (kilométrage au montage).
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="remove-note">Observation</Label>
            <Textarea
              id="remove-note"
              rows={2}
              maxLength={500}
              placeholder="Optionnel"
              value={removalReason}
              onChange={(e) => setRemovalReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removeMutation.isPending}>
            Fermer
          </Button>
          <Button onClick={submit} disabled={removeMutation.isPending || !canSubmit} data-testid="button-confirm-tire-removal">
            {removeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Démontage...
              </>
            ) : (
              "Valider le démontage"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
