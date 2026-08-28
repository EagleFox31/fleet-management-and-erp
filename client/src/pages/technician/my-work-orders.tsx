import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ClipboardList, Clock, Wrench, CheckCircle, AlertTriangle, Calendar, Truck, Play, CheckSquare, PlayCircle, CheckCircle2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useHelpPagePrepare } from "@/hooks/useHelpPagePrepare";
import { useToast } from "@/hooks/use-toast";
import { formatPrice, cn } from "@/lib/utils";
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

  const [partsUsed, setPartsUsed] = useState<Array<{id: string, partId: string, quantity: number, notes?: string}>>([]);
  const [newPartId, setNewPartId] = useState<string>("");
  const [newPartQuantity, setNewPartQuantity] = useState<string>("");
  const [newPartNotes, setNewPartNotes] = useState<string>("");
  const [mileageUpdate, setMileageUpdate] = useState<string>("");

  const { data: workOrdersData, isLoading } = useQuery<any>({
    queryKey: ['/api/technician/work-orders', user?.id],
    queryFn: () => fetch(`/api/technician/work-orders/${user?.id}`).then(res => res.json()),
    enabled: !!user?.id,
    staleTime: 30000,
  });

  const { data: partsData } = useQuery<any>({ queryKey: ['/api/parts'] });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ workOrderId, status, notes, partsUsed, mileageUpdate }: {
      workOrderId: number,
      status: string,
      notes?: string,
      partsUsed?: Array<{id: string, partId: string, quantity: number, notes?: string}>,
      mileageUpdate?: number
    }) => {
      const response = await fetch(`/api/technician/work-orders/${workOrderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes, partsUsed, mileageUpdate })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erreur lors de la mise à jour');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Statut mis à jour", description: "L'ordre de travail a été mis à jour avec succès." });
      queryClient.invalidateQueries({ queryKey: ['/api/technician/work-orders', user?.id] });
      if (selectedWorkOrder) {
        queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${selectedWorkOrder.id}/parts`] });
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${selectedWorkOrder.vehicleId}`] });
      }
      setIsUpdateModalOpen(false);
      setSelectedWorkOrder(null);
      setNotes("");
      setPartsUsed([]);
      setMileageUpdate("");
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: error.message || "Impossible de mettre à jour le statut.", variant: "destructive" });
    }
  });

  const handleUpdateStatus = (workOrder: any, targetStatus: string) => {
    setSelectedWorkOrder(workOrder);
    setNewStatus(targetStatus);
    setNotes("");
    setPartsUsed([]);
    setMileageUpdate("");
    setIsUpdateModalOpen(true);
  };

  const confirmUpdateStatus = () => {
    if (selectedWorkOrder && newStatus) {
      updateStatusMutation.mutate({
        workOrderId: selectedWorkOrder.id,
        status: newStatus,
        notes: notes.trim() || undefined,
        partsUsed: partsUsed.length > 0 ? partsUsed : undefined,
        mileageUpdate: mileageUpdate ? parseInt(mileageUpdate) : undefined
      });
    }
  };

  const addPartToList = () => {
    if (!newPartId || !newPartQuantity || parseFloat(newPartQuantity) <= 0) {
      toast({ title: "Erreur", description: "Veuillez sélectionner une pièce et indiquer une quantité valide.", variant: "destructive" });
      return;
    }
    setPartsUsed([...partsUsed, {
      id: Date.now().toString(),
      partId: newPartId,
      quantity: parseFloat(newPartQuantity),
      notes: newPartNotes.trim() || undefined
    }]);
    setNewPartId("");
    setNewPartQuantity("");
    setNewPartNotes("");
  };

  const removePartFromList = (partIndex: number) => {
    setPartsUsed(partsUsed.filter((_, index) => index !== partIndex));
  };

  const selectedVehicleMileage =
    typeof selectedWorkOrder?.vehicleMileage === "number" && Number.isFinite(selectedWorkOrder.vehicleMileage)
      ? selectedWorkOrder.vehicleMileage
      : null;

  const getNextActionButton = (workOrder: any) => {
    switch (workOrder.status) {
      case 'pending':
        return (
          <Button size="sm" onClick={() => handleUpdateStatus(workOrder, 'in_progress')} className="gap-1.5 text-xs h-8" data-help-target="tech-wo-start">
            <Play className="h-3.5 w-3.5" />
            Commencer
          </Button>
        );
      case 'in_progress':
        return (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(workOrder, 'in_progress')} className="gap-1.5 text-xs h-8" data-help-target="tech-wo-update">
              <Wrench className="h-3.5 w-3.5" />
              Mettre à jour
            </Button>
            <Button size="sm" onClick={() => handleUpdateStatus(workOrder, 'completed')} className="gap-1.5 text-xs h-8">
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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':   return 'text-red-600';
      case 'medium': return 'text-orange-600';
      case 'low':    return 'text-green-600';
      default:       return 'text-gray-600';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':   return 'Haute';
      case 'medium': return 'Moyenne';
      case 'low':    return 'Basse';
      default:       return 'Non définie';
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
    return (
      <CardShell className={cn(
        workOrder.priority === 'high' ? "border-l-[3px] border-l-red-400" :
        workOrder.priority === 'medium' ? "border-l-[3px] border-l-orange-400" :
        "border-l-[3px] border-l-gray-200"
      )}>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{workOrder.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-400">
                <Truck className="h-3 w-3" />
                <span>{workOrder.vehicleRegistrationNumber}</span>
                <span className="text-gray-200">•</span>
                <span>{workOrder.vehicleBrand} {workOrder.vehicleModel}</span>
              </div>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0", statusInfo.color)}>
              {statusInfo.label}
            </span>
          </div>

          {workOrder.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{workOrder.description}</p>
          )}

          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className={cn("font-semibold", getPriorityColor(workOrder.priority))}>
              Priorité {getPriorityLabel(workOrder.priority)}
            </span>
            {workOrder.startDate && (
              <span className="flex items-center gap-1 text-gray-400">
                <Calendar className="h-3 w-3" />
                {new Date(workOrder.startDate).toLocaleDateString('fr-FR')}
              </span>
            )}
            <span className="ml-auto text-gray-700 font-semibold">{formatPrice(workOrder.cost || 0)}</span>
          </div>

          {workOrder.diagnosis && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-0.5">Diagnostic</p>
              <p className="text-xs text-blue-700 line-clamp-2">{workOrder.diagnosis}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button variant="outline" size="sm" asChild className="flex-1 text-xs h-8">
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
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {newStatus === 'completed' ? "Terminer l'intervention" :
               selectedWorkOrder?.status === 'in_progress' && newStatus === 'in_progress' ? "Mettre à jour l'intervention" :
               "Commencer l'intervention"}
            </DialogTitle>
            <DialogDescription>
              {selectedWorkOrder && (
                <>
                  <span className="font-medium">{selectedWorkOrder.title}</span>
                  <br />
                  <span className="text-sm text-muted-foreground">
                    {selectedWorkOrder.vehicleRegistrationNumber} • {selectedWorkOrder.vehicleBrand} {selectedWorkOrder.vehicleModel}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor="notes">
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
              />
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label htmlFor="mileage">Mise à jour du kilométrage (optionnel)</Label>
              <Input
                id="mileage"
                type="number"
                placeholder={`Ex: ${selectedVehicleMileage !== null ? selectedVehicleMileage + 50 : '125000'}`}
                value={mileageUpdate}
                onChange={(e) => setMileageUpdate(e.target.value)}
              />
              <div className={cn(
                "rounded-md border px-3 py-2",
                selectedVehicleMileage !== null ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
              )}>
                <p className={cn("text-[11px] font-medium uppercase tracking-wide", selectedVehicleMileage !== null ? "text-emerald-700" : "text-amber-700")}>
                  Kilométrage actuel véhicule
                </p>
                <p className={cn("text-lg font-bold", selectedVehicleMileage !== null ? "text-emerald-800" : "text-amber-800")}>
                  {selectedVehicleMileage !== null ? `${selectedVehicleMileage.toLocaleString()} km` : "Non renseigné"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="grid gap-4" data-help-target="tech-wo-parts">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Pièces utilisées</Label>
                <span className="text-sm text-muted-foreground">{partsUsed.length} pièce(s) ajoutée(s)</span>
              </div>

              {partsUsed.length > 0 && (
                <div className="space-y-2">
                  {partsUsed.map((part, index) => {
                    const partInfo = Array.isArray(partsData?.parts) ? partsData.parts.find((p: any) => p.id.toString() === part.partId) : null;
                    return (
                      <div key={part.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{partInfo?.name || `Pièce #${part.partId}`}</div>
                          <div className="text-sm text-muted-foreground">
                            Quantité: {part.quantity} {part.notes && `• Notes: ${part.notes}`}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => removePartFromList(index)}>Retirer</Button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-12 gap-2 p-3 border rounded-lg">
                <div className="col-span-5">
                  <Label htmlFor="newPart" className="sr-only">Pièce</Label>
                  <Select value={newPartId} onValueChange={setNewPartId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une pièce" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.isArray(partsData?.parts) && partsData.parts.map((part: any) => (
                        <SelectItem key={part.id} value={part.id.toString()}>
                          {part.name} ({part.stock} en stock)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label htmlFor="newQuantity" className="sr-only">Quantité</Label>
                  <Input id="newQuantity" type="number" placeholder="Qté" value={newPartQuantity} onChange={(e) => setNewPartQuantity(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Label htmlFor="newPartNotes" className="sr-only">Notes</Label>
                  <Input id="newPartNotes" placeholder="Notes (optionnel)" value={newPartNotes} onChange={(e) => setNewPartNotes(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Button size="sm" onClick={addPartToList} disabled={!newPartId || !newPartQuantity} className="w-full">Ajouter</Button>
                </div>
              </div>
            </div>

            {newStatus === 'completed' && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Rappel :</strong> En terminant cette intervention, le statut du véhicule sera automatiquement mis à jour selon le type de maintenance effectuée.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUpdateModalOpen(false)}>Annuler</Button>
            <Button onClick={confirmUpdateStatus} disabled={updateStatusMutation.isPending}>
              {updateStatusMutation.isPending ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />Mise à jour...</>
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
