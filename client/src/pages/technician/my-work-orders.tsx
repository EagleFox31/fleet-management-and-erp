import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ClipboardList, Clock, Wrench, CheckCircle, AlertTriangle, Calendar, Truck, Play, CheckSquare, PlayCircle, CheckCircle2, Package } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useHelpPagePrepare } from "@/hooks/useHelpPagePrepare";
import { useToast } from "@/hooks/use-toast";
import { formatPrice, cn } from "@/lib/utils";
import {
  invalidateTechnicianWorkOrderQueries,
  TECHNICIAN_MY_WORK_ORDERS_KEY,
} from "@/lib/technician-work-orders-query";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";

type WorkOrdersTab = "pending" | "in_progress" | "completed";

function getTabFromQuery(): WorkOrdersTab {
  const queryStatus = new URLSearchParams(window.location.search).get("status");
  if (queryStatus === "pending" || queryStatus === "in_progress" || queryStatus === "completed") {
    return queryStatus;
  }
  return "pending";
}

export default function MyWorkOrdersPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedWorkOrder, setSelectedWorkOrder] = useState<any>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState<WorkOrdersTab>(() => getTabFromQuery());

  const [mileageUpdate, setMileageUpdate] = useState<string>("");

  const { data: workOrdersData, isLoading } = useQuery<any>({
    queryKey: TECHNICIAN_MY_WORK_ORDERS_KEY,
    enabled: !!user?.id && user?.role === "technician",
    staleTime: 0,
  });

  // Les pièces ne s'ajoutent pas ici : le technicien les demande depuis la fiche de l'OT,
  // le magasinier les sort du stock.
  const updateStatusMutation = useMutation({
    mutationFn: async ({ workOrderId, status, notes, mileageUpdate }: {
      workOrderId: number,
      status: string,
      notes?: string,
      mileageUpdate?: number
    }) => {
      const response = await fetch(`/api/technician/work-orders/${workOrderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes, mileageUpdate })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erreur lors de la mise à jour');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Statut mis à jour", description: "L'ordre de travail a été mis à jour avec succès." });
      invalidateTechnicianWorkOrderQueries(user?.id);
      if (selectedWorkOrder) {
        queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${selectedWorkOrder.id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${selectedWorkOrder.id}/parts`] });
        queryClient.invalidateQueries({ queryKey: [`/api/work-orders/vehicle/${selectedWorkOrder.vehicleId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${selectedWorkOrder.vehicleId}`] });
      }
      setIsUpdateModalOpen(false);
      setSelectedWorkOrder(null);
      setNotes("");
      setMileageUpdate("");
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Impossible de mettre à jour le statut."), variant: "destructive" });
    }
  });

  const handleUpdateStatus = (workOrder: any, targetStatus: string) => {
    setSelectedWorkOrder(workOrder);
    setNewStatus(targetStatus);
    setNotes("");
    setMileageUpdate("");
    setIsUpdateModalOpen(true);
  };

  const confirmUpdateStatus = () => {
    if (selectedWorkOrder && newStatus) {
      updateStatusMutation.mutate({
        workOrderId: selectedWorkOrder.id,
        status: newStatus,
        notes: notes.trim() || undefined,
        mileageUpdate: mileageUpdate ? parseInt(mileageUpdate) : undefined
      });
    }
  };

  const selectedVehicleMileage =
    typeof selectedWorkOrder?.vehicleMileage === "number" && Number.isFinite(selectedWorkOrder.vehicleMileage)
      ? selectedWorkOrder.vehicleMileage
      : null;

  const getNextActionButton = (workOrder: any) => {
    switch (workOrder.status) {
      case 'pending':
        return (
          <Button
            size="sm"
            onClick={() => handleUpdateStatus(workOrder, 'in_progress')}
            className="gap-1.5 text-xs h-8 flex-1 sm:flex-initial min-w-[120px] bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-xs"
            data-help-target="tech-wo-start"
          >
            <Play className="h-3.5 w-3.5" />
            Commencer
          </Button>
        );
      case 'in_progress':
        return (
          <div className="flex gap-2 flex-1 sm:flex-initial w-full sm:w-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleUpdateStatus(workOrder, 'in_progress')}
              className="gap-1.5 text-xs h-8 flex-1 sm:flex-initial min-w-[110px]"
              data-help-target="tech-wo-update"
            >
              <Wrench className="h-3.5 w-3.5" />
              Mettre à jour
            </Button>
            <Button
              size="sm"
              onClick={() => handleUpdateStatus(workOrder, 'completed')}
              className="gap-1.5 text-xs h-8 flex-1 sm:flex-initial min-w-[100px] bg-orange-600 hover:bg-orange-500 text-white font-medium shadow-xs"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Terminer
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'pending':   return { label: 'En attente', color: 'bg-amber-100 text-amber-700', icon: Clock };
      case 'in_progress': return { label: 'En cours', color: 'bg-blue-100 text-blue-700', icon: Wrench };
      case 'completed': return { label: 'Terminé', color: 'bg-green-100 text-green-700', icon: CheckCircle };
      case 'cancelled': return { label: 'Annulé', color: 'bg-red-100 text-red-700', icon: AlertTriangle };
      default:          return { label: 'Inconnu', color: 'bg-gray-100 text-gray-700', icon: AlertTriangle };
    }
  };

  const getPriorityColor = (priority: string | undefined | null) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
      case 'critique':
        return 'text-rose-600 font-bold';
      case 'high':
      case 'haute':
      case 'elevee':
      case 'élevée':
        return 'text-red-600';
      case 'medium':
      case 'moyenne':
        return 'text-orange-600';
      case 'low':
      case 'basse':
      case 'faible':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  const getPriorityLabel = (priority: string | undefined | null) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
      case 'critique':
        return 'Critique';
      case 'high':
      case 'haute':
      case 'elevee':
      case 'élevée':
        return 'Haute';
      case 'medium':
      case 'moyenne':
        return 'Moyenne';
      case 'low':
      case 'basse':
      case 'faible':
        return 'Basse';
      default:
        return 'Non définie';
    }
  };

  const myWorkOrders = (workOrdersData as any)?.workOrders || [];
  const stats = (workOrdersData as any)?.stats || { pending: 0, inProgress: 0, completed: 0, total: 0 };

  const pendingOrders = myWorkOrders.filter((wo: any) => wo.status === 'pending');
  const inProgressOrders = myWorkOrders.filter((wo: any) => wo.status === 'in_progress');
  const completedOrders = myWorkOrders.filter((wo: any) => wo.status === 'completed');

  useHelpPagePrepare({
    "tech-open-update-modal": () => {
      const workOrder = inProgressOrders[0] ?? pendingOrders[0];
      if (workOrder) {
        handleUpdateStatus(workOrder, "in_progress");
      }
    },
  });

  const WorkOrderCard = ({ workOrder }: { workOrder: any }) => {
    const statusInfo = getStatusInfo(workOrder.status);
    const isCritical = workOrder.priority?.toLowerCase() === 'critical' || workOrder.priority?.toLowerCase() === 'critique';
    return (
      <CardShell
        className={cn(
          "w-full max-w-full overflow-hidden transition-all",
          isCritical ? "border-l-[4px] border-l-rose-600 bg-rose-50/20 dark:bg-rose-950/20 shadow-xs" :
          workOrder.priority === 'high' ? "border-l-[3px] border-l-red-500" :
          workOrder.priority === 'medium' ? "border-l-[3px] border-l-orange-400" :
          "border-l-[3px] border-l-gray-200"
        )}
      >
        <div className="p-3.5 sm:px-5 sm:py-4 space-y-2.5 sm:space-y-3 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{workOrder.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">
                <Truck className="h-3 w-3 shrink-0" />
                <span className="font-medium text-gray-700 dark:text-gray-300 shrink-0">{workOrder.vehicleRegistrationNumber}</span>
                <span className="text-gray-300 dark:text-gray-600 shrink-0">•</span>
                <span className="truncate">{workOrder.vehicleBrand} {workOrder.vehicleModel}</span>
              </div>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0", statusInfo.color)}>
              {statusInfo.label}
            </span>
          </div>

          {workOrder.description && (
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">{workOrder.description}</p>
          )}

          <div className="flex items-center gap-3 sm:gap-4 text-xs flex-wrap text-muted-foreground">
            <span className={cn("font-semibold", getPriorityColor(workOrder.priority))}>
              Priorité {getPriorityLabel(workOrder.priority)}
            </span>
            {workOrder.startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(workOrder.startDate).toLocaleDateString('fr-FR')}
              </span>
            )}
            <span className="ml-auto text-gray-900 dark:text-gray-100 font-semibold">{formatPrice(workOrder.cost || 0)}</span>
          </div>

          {workOrder.diagnosis && (
            <div className="rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-0.5">Diagnostic</p>
              <p className="text-xs text-blue-800 dark:text-blue-200 line-clamp-2">{workOrder.diagnosis}</p>
            </div>
          )}

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1 w-full">
            <Button variant="outline" size="sm" asChild className="flex-1 min-w-[110px] text-xs h-8">
              <Link href={`/maintenance/work-orders/${workOrder.id}`}>Voir détails</Link>
            </Button>
            {getNextActionButton(workOrder)}
          </div>
        </div>
      </CardShell>
    );
  };

  const EmptyState = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => (
    <CardShell>
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
          <Icon className="h-6 w-6 text-gray-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <p className="text-xs text-gray-400 mt-1">{description}</p>
      </div>
    </CardShell>
  );

  const handleTabChange = (value: string) => {
    const nextTab: WorkOrdersTab =
      value === "pending" || value === "in_progress" || value === "completed" ? value : "pending";
    setActiveTab(nextTab);
    setLocation(`/technician/my-work-orders?status=${nextTab}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-32 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Technicien · Ordres de travail"
        title="Mes Ordres de Travail"
        subtitle="Interventions qui vous sont assignées"
        icon={<ClipboardList className="h-5 w-5" />}
      >
        <KpiGrid columns={3}>
          <KpiTile
            label="En attente"
            value={pendingOrders.length}
            subValue="À démarrer"
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-amber-50 text-amber-600"
          />
          <KpiTile
            label="En cours"
            value={inProgressOrders.length}
            subValue="Interventions actives"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Terminés"
            value={completedOrders.length}
            subValue="Interventions clôturées"
            icon={<CheckCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PremiumTabsNav
          helpTarget="tech-wo-tabs"
          tabs={[
            { value: "pending", label: `En attente (${pendingOrders.length})`, icon: <TabIcon icon={Clock} /> },
            { value: "in_progress", label: `En cours (${inProgressOrders.length})`, icon: <TabIcon icon={PlayCircle} /> },
            { value: "completed", label: `Terminés (${completedOrders.length})`, icon: <TabIcon icon={CheckCircle2} /> },
          ]}
        />

        <TabsContent value="pending" className="space-y-3">
          {pendingOrders.length === 0 ? (
            <EmptyState icon={Clock} title="Aucun ordre en attente" description="Tous vos ordres sont en cours ou terminés" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pendingOrders.map((wo: any) => <WorkOrderCard key={wo.id} workOrder={wo} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="in_progress" className="space-y-3">
          {inProgressOrders.length === 0 ? (
            <EmptyState icon={Wrench} title="Aucune intervention en cours" description="Commencez par un ordre en attente" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {inProgressOrders.map((wo: any) => <WorkOrderCard key={wo.id} workOrder={wo} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-3">
          {completedOrders.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Aucun ordre terminé" description="Vos interventions terminées apparaîtront ici" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {completedOrders.map((wo: any) => <WorkOrderCard key={wo.id} workOrder={wo} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de mise à jour */}
      <Dialog open={isUpdateModalOpen} onOpenChange={setIsUpdateModalOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-[650px] max-h-[88vh] flex flex-col p-0 overflow-hidden rounded-2xl mx-auto shadow-2xl border border-gray-200 dark:border-slate-800">
          <DialogHeader className="p-4 sm:p-6 pb-3 shrink-0 border-b border-gray-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
            <DialogTitle className="text-base sm:text-lg">
              {newStatus === 'completed' ? "Terminer l'intervention" :
               selectedWorkOrder?.status === 'in_progress' && newStatus === 'in_progress' ? "Mettre à jour l'intervention" :
               "Commencer l'intervention"}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {selectedWorkOrder && (
                <>
                  <span className="font-medium text-foreground">{selectedWorkOrder.title}</span>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    {selectedWorkOrder.vehicleRegistrationNumber} • {selectedWorkOrder.vehicleBrand} {selectedWorkOrder.vehicleModel}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-xs sm:text-sm font-semibold">
                {newStatus === 'completed' ? "Rapport d'intervention final" :
                 selectedWorkOrder?.status === 'in_progress' && newStatus === 'in_progress' ? "Mise à jour du diagnostic" :
                 "Diagnostic initial"}
              </Label>
              <Textarea
                id="notes"
                placeholder={
                  newStatus === 'completed'
                    ? "Décrivez les interventions finales réalisées, les tests effectués, l'état final du véhicule..."
                    : selectedWorkOrder?.status === 'in_progress' && newStatus === 'in_progress'
                    ? "Ajoutez des informations sur l'avancement, nouvelles observations..."
                    : "Décrivez l'état initial du véhicule et les vérifications effectuées..."
                }
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="text-xs sm:text-sm resize-none rounded-xl"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="mileage" className="text-xs sm:text-sm font-semibold">Mise à jour du kilométrage (optionnel)</Label>
              <Input
                id="mileage"
                type="number"
                placeholder={`Ex: ${selectedVehicleMileage !== null ? selectedVehicleMileage + 50 : '125000'}`}
                value={mileageUpdate}
                onChange={(e) => setMileageUpdate(e.target.value)}
                className="rounded-xl text-xs sm:text-sm"
              />
              <div className={cn(
                "rounded-xl border px-3 py-2",
                selectedVehicleMileage !== null ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/50" : "border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50"
              )}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-wide", selectedVehicleMileage !== null ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                  Kilométrage actuel véhicule
                </p>
                <p className={cn("text-base sm:text-lg font-bold", selectedVehicleMileage !== null ? "text-emerald-800 dark:text-emerald-200" : "text-amber-800 dark:text-amber-200")}>
                  {selectedVehicleMileage !== null ? `${selectedVehicleMileage.toLocaleString()} km` : "Non renseigné"}
                </p>
              </div>
            </div>

            <Separator />

            <div
              className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80"
              data-help-target="tech-wo-parts"
              data-testid="tech-wo-parts-info"
            >
              <Package className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="space-y-1 text-xs sm:text-sm">
                <p className="font-semibold text-foreground">Besoin d'une pièce ?</p>
                <p className="text-muted-foreground">
                  Demandez-la depuis la fiche de l'ordre de travail. Le magasin la sortira du stock.
                </p>
                {selectedWorkOrder && (
                  <Link
                    href={`/maintenance/work-orders/${selectedWorkOrder.id}`}
                    className="inline-block font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Ouvrir la fiche de l'OT
                  </Link>
                )}
              </div>
            </div>

            {newStatus === 'completed' && (
              <div className="p-3 bg-blue-50/90 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50">
                <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                  <strong>Rappel :</strong> En terminant cette intervention, le statut du véhicule sera automatiquement mis à jour selon le type de maintenance effectuée.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="p-4 sm:p-6 pt-3 shrink-0 border-t border-gray-100 dark:border-slate-800 flex flex-col-reverse sm:flex-row gap-2 bg-slate-50/60 dark:bg-slate-900/60">
            <Button variant="outline" onClick={() => setIsUpdateModalOpen(false)} className="w-full sm:w-auto text-xs h-9 rounded-xl">
              Annuler
            </Button>
            <Button onClick={confirmUpdateStatus} disabled={updateStatusMutation.isPending} className="w-full sm:w-auto text-xs h-9 rounded-xl">
              {updateStatusMutation.isPending ? (
                <><div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current mr-2" />Mise à jour...</>
              ) : (
                newStatus === 'completed' ? "Terminer l'intervention" :
                selectedWorkOrder?.status === 'in_progress' && newStatus === 'in_progress' ? "Mettre à jour" :
                "Commencer l'intervention"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
