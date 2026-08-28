import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TIRE_MOUNT_POSITIONS } from "@shared/constants/tires";
import { CircleDot, Loader2 } from "lucide-react";

interface TireCatalogRow {
  id: number;
  brand: string;
  model: string;
  size: string;
  stockQuantity: number;
}

interface FleetVehicleRow {
  id: number;
  registrationNumber: string;
  mileage?: number;
}

interface VehicleTireRow {
  vehicleId: number;
  position: string;
  status?: string;
}

interface VehicleTireMountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contexte fiche véhicule : véhicule verrouillé. Sinon, sélecteur affiché (suivi pneus). */
  vehicleId?: number;
  registrationNumber?: string;
  vehicleMileage?: number;
  preselectedTireId?: number;
  occupiedPositions?: string[];
  onMounted?: () => void;
}

const todayIso = () => new Date().toISOString().split("T")[0];

function parseApiErrorMessage(error: Error): string {
  const raw = error.message || "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      /* ignore */
    }
  }
  return raw || "Erreur lors du montage";
}

/** Choix A — montage atelier depuis le stock magasin (sortie stock + `vehicle_tires`). */
export function VehicleTireMountDialog({
  open,
  onOpenChange,
  vehicleId,
  registrationNumber,
  vehicleMileage,
  preselectedTireId,
  occupiedPositions = [],
  onMounted,
}: VehicleTireMountDialogProps) {
  const { toast } = useToast();
  const isVehicleLocked = vehicleId != null && vehicleId > 0;

  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [position, setPosition] = useState("");
  const [tireId, setTireId] = useState("");
  const [installationDate, setInstallationDate] = useState(todayIso());
  const [installationMileage, setInstallationMileage] = useState("0");
  const [currentTreadDepth, setCurrentTreadDepth] = useState("");
  const [initialTreadDepth, setInitialTreadDepth] = useState("");

  const effectiveVehicleId = isVehicleLocked ? vehicleId! : Number(selectedVehicleId);

  const { data: vehiclesList = [], isLoading: vehiclesLoading } = useQuery<FleetVehicleRow[]>({
    queryKey: ["/api/vehicles", "mount-picker"],
    enabled: open && !isVehicleLocked,
    queryFn: async () => {
      const response = await fetch("/api/vehicles?limit=500&status=operational,maintenance");
      if (!response.ok) throw new Error("Impossible de charger la flotte");
      const data = await response.json();
      return data.vehicles || [];
    },
  });

  const { data: allVehicleTires = [] } = useQuery<VehicleTireRow[]>({
    queryKey: ["/api/vehicle-tires"],
    enabled: open && !isVehicleLocked && effectiveVehicleId > 0,
  });

  const { data: tiresResponse, isLoading: tiresLoading } = useQuery<{ tires: TireCatalogRow[] }>({
    queryKey: ["/api/tires", { limit: 500 }],
    enabled: open,
  });

  const tiresCatalog = tiresResponse?.tires ?? [];

  const selectedFleetVehicle = useMemo(() => {
    if (isVehicleLocked) {
      return {
        id: vehicleId!,
        registrationNumber: registrationNumber ?? "—",
        mileage: vehicleMileage ?? 0,
      };
    }
    return vehiclesList.find((v) => v.id === effectiveVehicleId) ?? null;
  }, [effectiveVehicleId, isVehicleLocked, registrationNumber, vehicleId, vehicleMileage, vehiclesList]);

  const resolvedOccupiedPositions = useMemo(() => {
    if (isVehicleLocked) return occupiedPositions;
    return allVehicleTires
      .filter((row) => row.vehicleId === effectiveVehicleId && (row.status === undefined || row.status === "active"))
      .map((row) => row.position);
  }, [allVehicleTires, effectiveVehicleId, isVehicleLocked, occupiedPositions]);

  const availableTires = useMemo(
    () => tiresCatalog.filter((tire) => (tire.stockQuantity ?? 0) > 0),
    [tiresCatalog],
  );

  const availablePositions = useMemo(
    () => TIRE_MOUNT_POSITIONS.filter((p) => !resolvedOccupiedPositions.includes(p.value)),
    [resolvedOccupiedPositions],
  );

  useEffect(() => {
    if (!open) return;
    setInstallationDate(todayIso());
    setPosition("");
    setCurrentTreadDepth("");
    setInitialTreadDepth("");
    setSelectedVehicleId("");
    setTireId(preselectedTireId ? String(preselectedTireId) : "");
    setInstallationMileage(String(selectedFleetVehicle?.mileage ?? vehicleMileage ?? 0));
  }, [open, preselectedTireId, vehicleMileage]);

  useEffect(() => {
    if (!open || !selectedFleetVehicle) return;
    setInstallationMileage(String(selectedFleetVehicle.mileage ?? 0));
  }, [open, selectedFleetVehicle?.id, selectedFleetVehicle?.mileage]);

  const mountMutation = useMutation({
    mutationFn: async () => {
      const parsedTireId = Number(tireId);
      const parsedMileage = Number(installationMileage);
      if (!effectiveVehicleId || !position || !Number.isInteger(parsedTireId) || parsedTireId <= 0) {
        throw new Error("Véhicule, position et référence pneu obligatoires");
      }
      if (!Number.isFinite(parsedMileage) || parsedMileage < 0) {
        throw new Error("Kilométrage au montage invalide");
      }

      const body: Record<string, unknown> = {
        tireId: parsedTireId,
        position,
        installationDate,
        installationMileage: parsedMileage,
        status: "active",
      };

      const tread = Number(currentTreadDepth);
      const initialTread = Number(initialTreadDepth);
      if (Number.isFinite(tread) && tread > 0) {
        body.currentTreadDepth = tread;
      }
      if (Number.isFinite(initialTread) && initialTread > 0) {
        body.initialTreadDepth = initialTread;
      } else if (Number.isFinite(tread) && tread > 0) {
        body.initialTreadDepth = tread;
      }

      const response = await apiRequest("POST", `/api/vehicles/${effectiveVehicleId}/tires`, body);
      return response.json();
    },
    onSuccess: () => {
      const immat = selectedFleetVehicle?.registrationNumber ?? registrationNumber ?? "véhicule";
      toast({
        title: "Pneu monté",
        description: `Montage enregistré sur ${immat}. Le stock magasin a été décrémenté.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-tires"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${effectiveVehicleId}/tires`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      onMounted?.();
      setPosition("");
      if (!preselectedTireId) {
        setTireId("");
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Montage impossible",
        description: parseApiErrorMessage(error),
      });
    },
  });

  const selectedTire = availableTires.find((t) => String(t.id) === tireId);
  const displayRegistration = selectedFleetVehicle?.registrationNumber ?? registrationNumber ?? "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDot className="h-5 w-5 text-emerald-600" />
            Monter un pneu depuis le stock
          </DialogTitle>
          <DialogDescription className="text-left pt-1">
            {isVehicleLocked ? (
              <>
                Véhicule <span className="font-medium text-foreground">{displayRegistration}</span> — sortie
                magasin et enregistrement atelier pour la position choisie.
              </>
            ) : (
              <>Sortie magasin et enregistrement atelier — choisissez le véhicule et la position.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          {!isVehicleLocked && (
            <div className="grid gap-2">
              <Label htmlFor="mount-vehicle">Véhicule</Label>
              <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId} disabled={vehiclesLoading}>
                <SelectTrigger id="mount-vehicle">
                  <SelectValue placeholder={vehiclesLoading ? "Chargement..." : "Choisir un véhicule"} />
                </SelectTrigger>
                <SelectContent>
                  {vehiclesList.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      Aucun véhicule disponible
                    </SelectItem>
                  ) : (
                    vehiclesList.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                        {vehicle.registrationNumber}
                        {vehicle.mileage != null ? ` · ${vehicle.mileage.toLocaleString("fr-FR")} km` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="mount-position">Position</Label>
            <Select
              value={position}
              onValueChange={setPosition}
              disabled={!effectiveVehicleId || availablePositions.length === 0}
            >
              <SelectTrigger id="mount-position">
                <SelectValue
                  placeholder={
                    !effectiveVehicleId
                      ? "Choisir un véhicule d'abord"
                      : availablePositions.length === 0
                        ? "Toutes les positions sont occupées"
                        : "Choisir une position"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availablePositions.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mount-tire">Référence en stock</Label>
            <Select
              value={tireId}
              onValueChange={setTireId}
              disabled={tiresLoading || !!preselectedTireId}
            >
              <SelectTrigger id="mount-tire">
                <SelectValue placeholder={tiresLoading ? "Chargement..." : "Choisir un pneu"} />
              </SelectTrigger>
              <SelectContent>
                {availableTires.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    Aucun pneu disponible en stock
                  </SelectItem>
                ) : (
                  availableTires.map((tire) => (
                    <SelectItem key={tire.id} value={String(tire.id)}>
                      {tire.brand} {tire.model} · {tire.size} · stock {tire.stockQuantity}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedTire ? (
              <p className="text-xs text-muted-foreground">
                {selectedTire.stockQuantity} unité(s) restante(s) après ce montage.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="mount-date">Date de montage</Label>
              <Input
                id="mount-date"
                type="date"
                value={installationDate}
                onChange={(e) => setInstallationDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mount-km">Kilométrage au montage</Label>
              <Input
                id="mount-km"
                type="number"
                min={0}
                value={installationMileage}
                onChange={(e) => setInstallationMileage(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="mount-tread">Sculpture actuelle (mm)</Label>
              <Input
                id="mount-tread"
                type="number"
                min={0}
                step={0.1}
                placeholder="Optionnel"
                value={currentTreadDepth}
                onChange={(e) => setCurrentTreadDepth(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mount-initial-tread">Sculpture initiale (mm)</Label>
              <Input
                id="mount-initial-tread"
                type="number"
                min={0}
                step={0.1}
                placeholder="Optionnel"
                value={initialTreadDepth}
                onChange={(e) => setInitialTreadDepth(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mountMutation.isPending}>
            Fermer
          </Button>
          <Button
            onClick={() => mountMutation.mutate()}
            disabled={
              mountMutation.isPending ||
              !effectiveVehicleId ||
              !position ||
              !tireId ||
              availableTires.length === 0 ||
              availablePositions.length === 0
            }
          >
            {mountMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Montage...
              </>
            ) : (
              "Valider le montage"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
