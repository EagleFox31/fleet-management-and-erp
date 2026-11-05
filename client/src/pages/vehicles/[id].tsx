import { isApiError, userMessageOf } from "@/lib/api-error";
import { vehicleUnavailable } from "@/lib/vehicle-load-error";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { VehicleDocuments } from "@/components/vehicles/vehicle-documents";
import { VehicleStatusHistory } from "@/components/vehicles/vehicle-status-history";
import { WorkOrderTable } from "@/components/maintenance/work-order-table";
import { WorkOrderForm } from "@/components/maintenance/work-order-form";
import { FuelRecordTable } from "@/components/fuel/fuel-record-table";
import { formatDate, formatDistance, getStatusColor, translateStatus } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Wrench, Fuel, Trash2, Plus, ArrowLeft, Car, Calendar, Gauge,
  FileText, Clock, Edit, AlertTriangle, CheckCircle, Activity, FolderOpen, Lock, RefreshCw,
} from "lucide-react";
import { MaintenanceScheduleForm } from "@/components/maintenance/maintenance-schedule-form";
import { DeadlineTile, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { VehicleTiresUnregisteredBadge } from "@/components/vehicles/vehicle-tires-status-badge";
import { VehicleTiresPromptDialog } from "@/components/vehicles/vehicle-tires-prompt-dialog";
import { VehicleTireMountDialog } from "@/components/vehicles/vehicle-tire-mount-dialog";
import { vehicleHasRegisteredTires } from "@/lib/vehicle-tires-status";
import { canMountTiresFromStock } from "@/lib/auth";

const VEHICLE_DETAIL_TABS = [
  "details",
  "maintenance",
  "work-orders",
  "fuel",
  "status-history",
  "documents",
] as const;

type VehicleDetailTab = (typeof VEHICLE_DETAIL_TABS)[number];

const buildReturnPath = (raw: string | null, fallback: string): string => {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed.startsWith("/") ? trimmed : fallback;
};

export default function VehicleDetails({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(search || ""), [search]);
  const returnTo = buildReturnPath(urlParams.get("returnTo"), "/vehicles");
  const backFromDocuments = returnTo.startsWith("/vehicles/documents");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isAddScheduleDialogOpen, setIsAddScheduleDialogOpen] = useState(false);
  const [isAddWorkOrderDialogOpen, setIsAddWorkOrderDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<VehicleDetailTab>("details");
  const [showTiresPrompt, setShowTiresPrompt] = useState(false);
  const [showTireMountDialog, setShowTireMountDialog] = useState(false);

  useEffect(() => {
    const tab = urlParams.get("tab");
    if (tab && (VEHICLE_DETAIL_TABS as readonly string[]).includes(tab)) {
      setActiveTab(tab as VehicleDetailTab);
    }
  }, [urlParams]);

  const idOrRegistration = decodeURIComponent(params.id);

  const {
    data: vehicle,
    isLoading: isLoadingVehicle,
    error: vehicleError,
    refetch: refetchVehicle,
    isFetching: isFetchingVehicle,
  } = useQuery<any>({
    queryKey: [`/api/vehicles/${idOrRegistration}`],
    staleTime: 0,
    refetchOnMount: "always",
    // Un refus ou une absence ne change pas en réessayant.
    retry: (failureCount, error) => !isApiError(error, 403) && !isApiError(error, 404) && failureCount < 1,
  });

  const vehicleId = vehicle?.id;

  const { data: maintenanceSchedules } = useQuery<any>({
    queryKey: [`/api/maintenance-schedules/vehicle/${vehicleId}`],
    enabled: !!vehicleId,
  });

  const { data: vehicleDocuments = [] } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}/documents`],
    enabled: !!vehicleId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: vehicleWorkOrders = [] } = useQuery<any[]>({
    queryKey: [`/api/work-orders/vehicle/${vehicleId}`],
    enabled: !!vehicleId,
  });

  const { data: vehicleFuelRecords = [] } = useQuery<any[]>({
    queryKey: [`/api/fuel-records/vehicle/${vehicleId}`],
    enabled: !!vehicleId,
  });

  const { data: vehicleMountedTires = [] } = useQuery<unknown[]>({
    queryKey: [`/api/vehicles/${vehicleId}/tires`],
    enabled: !!vehicleId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const tiresRegistered = vehicleHasRegisteredTires(vehicleMountedTires);
  const canOpenTireTracking = ["admin", "workshop_manager", "technician", "warehouse", "secretary", "logistics"].includes(
    user?.role ?? "",
  );
  const canMountFromStock = canMountTiresFromStock(user);

  const occupiedTirePositions = useMemo(() => {
    return (vehicleMountedTires as Record<string, unknown>[])
      .filter((row) => {
        const status = row.status ?? (row.vehicle_tires as Record<string, unknown> | undefined)?.status;
        return status === undefined || status === "active";
      })
      .map((row) => String(row.position ?? (row.vehicle_tires as Record<string, unknown> | undefined)?.position ?? ""))
      .filter(Boolean);
  }, [vehicleMountedTires]);

  const openTireMountDialog = () => {
    setShowTiresPrompt(false);
    setShowTireMountDialog(true);
  };

  useEffect(() => {
    if (urlParams.get("tiresPrompt") === "1" && vehicle && !tiresRegistered) {
      setShowTiresPrompt(true);
    }
  }, [urlParams, vehicle, tiresRegistered]);

  const dismissTiresPrompt = () => {
    setShowTiresPrompt(false);
    if (urlParams.get("tiresPrompt")) {
      setLocation(`/vehicles/${encodeURIComponent(vehicle.registrationNumber)}`);
    }
  };

  const deleteVehicleMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/vehicles/${vehicleId}`),
    onSuccess: () => {
      toast({ title: "Véhicule supprimé", description: "Le véhicule a été supprimé avec succès." });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setLocation("/vehicles");
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Erreur lors de la suppression du véhicule.") });
    },
  });

  const handleDelete = () => {
    if (user?.role !== "admin") return;
    deleteVehicleMutation.mutate();
    setIsDeleteDialogOpen(false);
  };

  const activeWorkOrders = Array.isArray(vehicleWorkOrders)
    ? vehicleWorkOrders.filter((wo: any) => ["pending", "in_progress", "awaiting_parts"].includes(wo.status))
    : [];
  const activeWorkOrder = activeWorkOrders[0] || null;

  const resolveWorkOrderTrigger = (workOrder: any) => {
    if (!workOrder) return { title: "Aucune OT active trouvée", details: "Le statut semble défini manuellement." };
    const title = (workOrder.title || "").toLowerCase();
    if (workOrder.maintenanceScheduleId) return { title: "Maintenance préventive planifiée", details: "Déclenchée automatiquement depuis une planification atelier." };
    if (workOrder.isPreventive) {
      if (title.includes("kilométr")) return { title: "Maintenance préventive par kilométrage", details: "Le seuil kilométrique planifié a été atteint." };
      return { title: "Maintenance préventive par date", details: "La date de maintenance préventive est arrivée/échue." };
    }
    return { title: "Maintenance corrective (panne / incident)", details: "Une OT corrective a été créée après signalement ou diagnostic atelier." };
  };

  const workshopAction =
    user?.role === "admin" || user?.role === "workshop_manager"
      ? "Chef d'atelier: vérifier l'OT, assigner le technicien et lancer l'intervention."
      : user?.role === "technician"
        ? "Technicien: ouvrir l'OT assignée, cliquer Commencer, puis renseigner diagnostic et notes."
        : "Action: ouvrir l'OT active pour voir la cause détaillée et les tâches à réaliser.";

  // Résumé carburant du véhicule. `quantity` est en litres, `date` peut être nulle.
  const fuelSummary = React.useMemo(() => {
    const records = Array.isArray(vehicleFuelRecords) ? vehicleFuelRecords : [];
    const litres = records.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const dates = records
      .map((r) => (r.date ? new Date(r.date) : null))
      .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
    const dernier = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

    return { nombre: records.length, litres, dernier };
  }, [vehicleFuelRecords]);

  const canCreateWorkOrder = user?.role === "admin" || user?.role === "workshop_manager";
  const activeTrigger = resolveWorkOrderTrigger(activeWorkOrder);

  const getVehicleTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      tracteur: "Tracteur", porteur: "Porteur", semi_remorque: "Semi-remorque",
      remorque: "Remorque", utilitaire: "Utilitaire",
    };
    return map[type] || "Autre";
  };

  const getFuelTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      diesel: "Diesel", petrol: "Essence", electric: "Électrique", hybrid: "Hybride",
    };
    return map[type] || "Autre";
  };

  if (isLoadingVehicle) {
    return (
      <div className="space-y-5">
        <div className="h-48 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="grid grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!vehicle) {
    const unavailable = vehicleUnavailable(vehicleError);
    const UnavailableIcon = unavailable.kind === "forbidden" ? Lock : AlertTriangle;
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <UnavailableIcon className="h-10 w-10 text-destructive-text mb-3" />
        <h2 className="text-lg font-semibold text-foreground">{unavailable.title}</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">{unavailable.message}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {unavailable.retryable && (
            <Button variant="outline" onClick={() => refetchVehicle()} disabled={isFetchingVehicle}>
              <RefreshCw className={`h-4 w-4 mr-2${isFetchingVehicle ? " animate-spin" : ""}`} />
              Réessayer
            </Button>
          )}
          <Button onClick={() => setLocation(returnTo)}>
            {backFromDocuments ? "Retour Documents & Conformité" : "Retour à la liste"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          {/* En-tête sur une seule ligne: identité à gauche, actions à droite.
              Avant, trois lignes séparées (retour, badge de statut, titre) et le
              module label « Flotte · Véhicule » qui répétait le fil d'Ariane. */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              {backFromDocuments ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1 h-9 shrink-0 text-xs text-muted-foreground"
                  onClick={() => setLocation(returnTo)}
                >
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Documents & Conformité
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-gray-400 hover:text-gray-600"
                  onClick={() => setLocation(returnTo)}
                  aria-label="Retour à la liste des véhicules"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}

              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <Car className="h-5 w-5 text-green-600" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900 truncate">
                    {vehicle.brand} {vehicle.model}
                  </h1>
                  <Badge className={getStatusColor(vehicle.status)}>{translateStatus(vehicle.status)}</Badge>
                  {vehicle.isPreventive && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Préventive</Badge>
                  )}
                  {!tiresRegistered && <VehicleTiresUnregisteredBadge />}
                </div>
                {/* Le kilométrage a sa propre tuile plus bas: on ne le répète pas ici,
                    on met le type à la place. */}
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {vehicle.registrationNumber} · {getVehicleTypeLabel(vehicle.vehicleType)} ·{" "}
                  {getFuelTypeLabel(vehicle.fuelType)} · Année {vehicle.year}
                </p>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              {canCreateWorkOrder && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                  onClick={() => setLocation(`/maintenance/work-orders/new?vehicleId=${vehicleId}&registration=${encodeURIComponent(vehicle.registrationNumber)}`)}>
                  <Wrench className="h-3.5 w-3.5" /> Créer un OT
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                onClick={() => setLocation(`/fuel/new?vehicleId=${vehicleId}&registration=${encodeURIComponent(vehicle.registrationNumber)}`)}>
                <Fuel className="h-3.5 w-3.5" /> Ajouter un plein
              </Button>
              {user?.role === "admin" && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1.5 h-8 text-xs">
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirmer la suppression</DialogTitle>
                      <DialogDescription>Êtes-vous sûr de vouloir supprimer ce véhicule ? Cette action est irréversible.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Annuler</Button>
                      <Button variant="destructive" onClick={handleDelete} disabled={deleteVehicleMutation.isPending}>
                        {deleteVehicleMutation.isPending ? "Suppression..." : "Supprimer"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          {/* Tuiles KPI — « Type » dans le sous-titre ; OT actives en 6e tuile */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-5 border-t border-gray-100">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Gauge className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Kilométrage</p>
              <p className="text-[13px] font-bold text-gray-800">{formatDistance(vehicle.mileage)}</p>
            </div>
            <div
              className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("fuel")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab("fuel");
                }
              }}
              data-testid="vehicle-kpi-fuel"
            >
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <Fuel className="h-4 w-4 text-orange-500" />
              </div>
              {/* Le type de carburant est une donnée d'identité, immuable: il est
                  passé dans le sous-titre. La tuile porte désormais l'exploitation,
                  et devient cliquable vers l'onglet Carburant. */}
              <p className="text-[11px] font-medium text-gray-500 mt-1">Carburant</p>
              <p className="text-[13px] font-bold text-gray-800">
                {fuelSummary.nombre === 0
                  ? "Aucun plein"
                  : `${fuelSummary.nombre} plein${fuelSummary.nombre > 1 ? "s" : ""}`}
              </p>
              <p className="text-[10px] text-gray-400">
                {fuelSummary.nombre === 0
                  ? "Rien d'enregistré"
                  : `${Math.round(fuelSummary.litres).toLocaleString("fr-FR")} L au total`}
              </p>
            </div>
            {/* Échéances: état, couleur et icône calculés depuis la date.
                Rien à maintenir ici quand le seuil d'alerte change. */}
            <DeadlineTile
              label="Prochain entretien"
              date={vehicle.nextMaintenanceDate}
              icon={<Calendar className="h-4 w-4" />}
              kind="action"
              emptyLabel="Non planifié"
              onClick={() => setActiveTab("maintenance")}
              data-testid="vehicle-deadline-maintenance"
            />
            <DeadlineTile
              label="Assurance"
              date={vehicle.insuranceExpiry}
              icon={<FileText className="h-4 w-4" />}
              onClick={() => setActiveTab("documents")}
              data-testid="vehicle-deadline-insurance"
            />
            <DeadlineTile
              label="Visite technique"
              date={vehicle.technicalInspectionDate}
              icon={<CheckCircle className="h-4 w-4" />}
              onClick={() => setActiveTab("documents")}
              data-testid="vehicle-deadline-inspection"
            />
            <div
              className={`rounded-xl border px-4 py-3.5 flex flex-col gap-1 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                activeWorkOrders.length > 0
                  ? "border-amber-200 bg-amber-50/80"
                  : "border-gray-100 bg-gray-50"
              }`}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab("work-orders")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab("work-orders");
                }
              }}
              data-testid="vehicle-kpi-active-work-orders"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                activeWorkOrders.length > 0 ? "bg-amber-100" : "bg-gray-100"
              }`}>
                <Wrench className={`h-4 w-4 ${activeWorkOrders.length > 0 ? "text-amber-700" : "text-gray-500"}`} />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">OT actives</p>
              <p className={`text-[13px] font-bold ${activeWorkOrders.length > 0 ? "text-amber-900" : "text-gray-800"}`}>
                {activeWorkOrders.length === 0 ? "Aucune" : activeWorkOrders.length}
              </p>
              <p className="text-[10px] text-gray-400">
                {activeWorkOrders.length === 0
                  ? "Aucune intervention ouverte"
                  : activeWorkOrders.length === 1
                    ? "1 intervention en cours"
                    : `${activeWorkOrders.length} interventions en cours`}
              </p>
            </div>
          </div>

          {/* Maintenance alert */}
          {(vehicle.status === "maintenance" || activeWorkOrders.length > 0) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    {vehicle.status === "maintenance"
                      ? 'Pourquoi "En maintenance" ?'
                      : `${activeWorkOrders.length} OT active${activeWorkOrders.length > 1 ? "s" : ""}`}
                  </p>
                  {activeWorkOrder && (
                    <p className="text-xs text-amber-800 mt-0.5">{activeTrigger.title} — {activeTrigger.details}</p>
                  )}
                  {activeWorkOrders.length > 0 && (
                    <p className="text-xs text-amber-800 font-medium mt-1">
                      {activeWorkOrders.length} OT active{activeWorkOrders.length > 1 ? "s" : ""} — le véhicule reste en maintenance tant qu&apos;au moins une n&apos;est pas clôturée.
                    </p>
                  )}
                  <p className="text-xs text-amber-700 font-medium mt-1">{workshopAction}</p>
                  {activeWorkOrders.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {activeWorkOrders.map((wo: { id: number; status: string; title?: string }) => (
                        <li key={wo.id}>
                          <button
                            type="button"
                            onClick={() => setLocation(`/maintenance/work-orders/${wo.id}`)}
                            className="text-xs text-amber-900 underline hover:text-amber-700 text-left"
                          >
                            OT #{wo.id} · {translateStatus(wo.status)}{wo.title ? ` · ${wo.title}` : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-amber-700 mt-1">
                      Aucune OT ouverte trouvée — le statut semble défini manuellement.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!tiresRegistered && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">Pneus non renseignés</p>
              <p className="text-xs text-amber-800/80 mt-0.5">
                Aucun montage enregistré par l&apos;atelier. Le véhicule reste utilisable ; le suivi usure
                et rotations démarrera après saisie des pneus montés.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {canMountFromStock && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-200 bg-white/80 hover:bg-white"
                onClick={openTireMountDialog}
              >
                Monter depuis le stock
              </Button>
            )}
            {canOpenTireTracking && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-200 bg-white/80 hover:bg-white"
                onClick={() => setLocation("/inventory/tires")}
              >
                Suivi pneus
              </Button>
            )}
          </div>
        </div>
      )}

      <VehicleTiresPromptDialog
        open={showTiresPrompt}
        onOpenChange={(open) => {
          if (open) {
            setShowTiresPrompt(true);
          } else {
            dismissTiresPrompt();
          }
        }}
        registrationNumber={vehicle.registrationNumber}
        canOpenTireTracking={canOpenTireTracking}
        canMountFromStock={canMountFromStock}
        onLater={dismissTiresPrompt}
        onMountFromStock={
          canMountFromStock
            ? () => {
                dismissTiresPrompt();
                openTireMountDialog();
              }
            : undefined
        }
        onOpenTireTracking={
          canOpenTireTracking
            ? () => {
                dismissTiresPrompt();
                setLocation("/inventory/tires");
              }
            : undefined
        }
      />

      {vehicleId && (
        <VehicleTireMountDialog
          open={showTireMountDialog}
          onOpenChange={setShowTireMountDialog}
          vehicleId={vehicleId}
          registrationNumber={vehicle.registrationNumber}
          vehicleMileage={vehicle.mileage ?? 0}
          occupiedPositions={occupiedTirePositions}
        />
      )}

      {/* Dialogues */}
      <Dialog open={isAddScheduleDialogOpen} onOpenChange={setIsAddScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouvelle planification de maintenance</DialogTitle>
            <DialogDescription>Créez une nouvelle planification de maintenance préventive pour ce véhicule.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <MaintenanceScheduleForm
              vehicleId={vehicleId}
              onSuccess={() => {
                setIsAddScheduleDialogOpen(false);
                queryClient.invalidateQueries({ queryKey: [`/api/maintenance-schedules/vehicle/${vehicleId}`] });
              }}
              onCancel={() => setIsAddScheduleDialogOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {canCreateWorkOrder && (
        <Dialog open={isAddWorkOrderDialogOpen} onOpenChange={setIsAddWorkOrderDialogOpen}>
          <DialogContent className="sm:max-w-[850px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nouvel ordre de travail</DialogTitle>
              <DialogDescription>Créez un nouvel ordre de travail pour ce véhicule.</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <WorkOrderForm
                preselectedVehicleId={vehicleId}
                initialData={{ vehicleRegistration: vehicle?.registrationNumber || "" }}
                onSuccess={() => {
                  setIsAddWorkOrderDialogOpen(false);
                  queryClient.invalidateQueries({ queryKey: [`/api/work-orders/vehicle/${vehicleId}`] });
                  toast({ title: "Ordre de travail créé", description: "L'ordre de travail a été créé avec succès." });
                }}
                onCancel={() => setIsAddWorkOrderDialogOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Tabs ── */}
      <Tabs
        defaultValue="details"
        value={activeTab}
        onValueChange={(value) => {
          if ((VEHICLE_DETAIL_TABS as readonly string[]).includes(value)) {
            setActiveTab(value as VehicleDetailTab);
          }
        }}
      >
        <PremiumTabsNav tabs={[
          { value: "details", label: "Détails", icon: <TabIcon icon={FileText} /> },
          { value: "maintenance", label: "Planifications", icon: <TabIcon icon={Calendar} /> },
          { value: "work-orders", label: "Ordres de travail", icon: <TabIcon icon={Wrench} /> },
          { value: "fuel", label: "Carburant", icon: <TabIcon icon={Fuel} /> },
          { value: "status-history", label: "Santé du véhicule", icon: <TabIcon icon={Activity} /> },
          { value: "documents", label: "Documents", icon: <TabIcon icon={FolderOpen} /> },
        ]} className="flex-wrap" />

        {/* Détails */}
        <TabsContent value="details">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <Car className="h-3.5 w-3.5 text-green-600" />
              </div>
              <span className="text-sm font-semibold text-gray-800">Informations du véhicule</span>
            </div>
            <div className="px-5 py-4">
              <VehicleForm initialData={vehicle} isEdit={true} vehicleId={vehicleId} />
            </div>
          </div>
        </TabsContent>

        {/* Planifications */}
        <TabsContent value="maintenance">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-purple-500 to-violet-400" />
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Calendar className="h-3.5 w-3.5 text-purple-600" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800">Planifications de maintenance</span>
                  <p className="text-xs text-gray-400">Maintenance préventive programmée</p>
                </div>
              </div>
              <Button size="sm" onClick={() => setIsAddScheduleDialogOpen(true)} className="gap-1.5 h-8 text-xs">
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            <div className="px-5 py-4">
              {maintenanceSchedules && maintenanceSchedules.length > 0 ? (
                <div className="space-y-3">
                  {maintenanceSchedules.map((schedule: any) => (
                    <div key={schedule.id} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-gray-800">{schedule.title}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${schedule.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {schedule.isActive ? "Actif" : "Inactif"}
                        </span>
                      </div>
                      {schedule.description && (
                        <p className="text-xs text-gray-500 mt-1">{schedule.description}</p>
                      )}
                      <Separator className="my-3" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Fréquence</div>
                          <div className="font-medium text-gray-700 mt-0.5">
                            {schedule.frequency === "daily" && "Quotidienne"}
                            {schedule.frequency === "weekly" && "Hebdomadaire"}
                            {schedule.frequency === "monthly" && "Mensuelle"}
                            {schedule.frequency === "quarterly" && "Trimestrielle"}
                            {schedule.frequency === "yearly" && "Annuelle"}
                            {schedule.frequency === "mileage" && "Kilométrage"}
                            {schedule.frequencyValue > 1 && ` (${schedule.frequencyValue})`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Prochaine maintenance</div>
                          <div className="font-medium text-gray-700 mt-0.5">
                            {schedule.scheduledDate ? formatDate(schedule.scheduledDate) : "Non défini"}
                            {schedule.scheduledMileage && ` ou ${formatDistance(schedule.scheduledMileage)}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-3">
                        <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                          onClick={() => setLocation(`/maintenance/${schedule.id}?vehicleId=${vehicleId}`)}>
                          <Edit className="h-3 w-3" /> Modifier
                        </Button>
                        {canCreateWorkOrder && (
                          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                            onClick={() => setLocation(`/maintenance/work-orders/new?vehicleId=${vehicleId}&scheduleId=${schedule.id}`)}>
                            <Wrench className="h-3 w-3" /> Créer OT
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mb-3">
                    <Calendar className="h-5 w-5 text-purple-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">Aucune planification</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Ajoutez une planification de maintenance pour ce véhicule.</p>
                  <Button size="sm" onClick={() => setIsAddScheduleDialogOpen(true)} className="gap-2">
                    <Plus className="h-3.5 w-3.5" /> Ajouter une planification
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Ordres de travail */}
        <TabsContent value="work-orders">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-orange-400 to-amber-300" />
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                  <Wrench className="h-3.5 w-3.5 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-gray-800">Ordres de travail</span>
                  <p className="text-xs text-gray-400">Historique des interventions</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  {vehicleWorkOrders.length}
                </span>
                {canCreateWorkOrder && (
                  <Button size="sm" onClick={() => setIsAddWorkOrderDialogOpen(true)} className="gap-1.5 h-8 text-xs">
                    <Plus className="h-3.5 w-3.5" /> Ajouter un OT
                  </Button>
                )}
              </div>
            </div>
            <WorkOrderTable vehicleId={vehicleId} hideToolbar />
          </div>
        </TabsContent>

        {/* Carburant */}
        <TabsContent value="fuel">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-blue-500 to-sky-400" />
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <Fuel className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-800">Suivi carburant</span>
                <p className="text-xs text-gray-400">Consommation et statistiques</p>
              </div>
            </div>
            <div className="p-5">
              <FuelRecordTable vehicleId={vehicleId} />
            </div>
          </div>
        </TabsContent>

        {/* Historique statuts */}
        <TabsContent value="status-history">
          <VehicleStatusHistory vehicleId={vehicleId} />
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <VehicleDocuments vehicleId={vehicleId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
