import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CalendarDays,
  Clock,
  AlertTriangle,
  CheckCircle,
  Users,
  Wrench,
  TrendingUp,
  Plus,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Gauge,
  Trash2,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  CalendarCheck,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { HeaderCard, KpiGrid, KpiTile, PremiumTabsNav, SectionLabel } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";

interface WorkOrder {
  id: number;
  title: string;
  description: string;
  vehicleId: number;
  vehicleRegistrationNumber: string;
  vehicleRegistration?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  technicianId?: number;
  technicianName?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "awaiting_parts";
  priority: "low" | "medium" | "high" | "critical";
  estimatedDuration?: number;
  scheduledDate?: string;
  createdAt: string;
}

interface MaintenanceSchedule {
  id: number;
  title: string;
  vehicleId: number;
  vehicleRegistrationNumber: string;
  type: "preventive" | "inspection" | "service";
  scheduledDate: string;
  status: "planned" | "overdue" | "completed";
  technicianId?: number;
  technicianName?: string;
}

export default function GMAODashboard() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedTechnician, setSelectedTechnician] = useState<number | null>(null);
  const [activeView, setActiveView] = useState("calendar");
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Mutation pour supprimer les OT en attente non assignés (admin uniquement)
  const deletePendingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/work-orders/bulk-pending-unassigned");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      queryClient.refetchQueries({ queryKey: ["/api/work-orders"], type: "active" });
    },
  });

  // Charger les données
  const { data: workOrdersData } = useQuery<any>({
    queryKey: ["/api/work-orders"],
  });

  const { data: schedulesData, isError: schedulesFailed, error: schedulesError, refetch: refetchSchedules } = useQuery<any>({
    queryKey: ["/api/maintenance-schedules"],
  });

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/users"],
  });

  const { data: performanceStats } = useQuery<any>({
    queryKey: ["/api/work-orders/statistics"],
  });

  const workOrders = Array.isArray(workOrdersData) ? workOrdersData : workOrdersData?.workOrders || [];
  const schedules = Array.isArray(schedulesData) ? schedulesData : [];
  const technicians = Array.isArray(usersData)
    ? usersData.filter((u: any) => u.role === "technician" || u.role === "workshop_manager")
    : [];

  // Mutation pour vérifier toutes les maintenances
  const checkAllMaintenanceMutation = useMutation({
    mutationFn: async () => {
      setIsChecking(true);
      const response = await fetch("/api/check-all-maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error("Erreur lors de la vérification");
      }
      return response.json();
    },
    onSuccess: () => {
      setLastCheckTime(new Date());
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-schedules"] });
    },
    onError: (error) => {
      console.error("Erreur:", error);
    },
    onSettled: () => {
      setIsChecking(false);
    },
  });

  // Statistiques rapides
  const stats = {
    totalWorkOrders: workOrders.length,
    pendingWorkOrders: workOrders.filter((wo: WorkOrder) => wo.status === "pending").length,
    inProgressWorkOrders: workOrders.filter((wo: WorkOrder) => wo.status === "in_progress" || wo.status === "awaiting_parts").length,
    unassignedWorkOrders: workOrders.filter((wo: WorkOrder) => !wo.technicianId).length,
    overdueSchedules: schedules.filter((s: MaintenanceSchedule) => s.status === "overdue").length,
    availableTechnicians: technicians.length,
  };

  // Interventions du jour sélectionné
  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const dayInterventions = [
    ...workOrders
      .filter(
        (wo: WorkOrder) =>
          wo.scheduledDate === selectedDateStr ||
          (!wo.scheduledDate && format(new Date(wo.createdAt), "yyyy-MM-dd") === selectedDateStr),
      )
      .map((wo: WorkOrder) => ({ ...wo, isPreventive: !!wo.scheduledDate })),
    ...schedules
      .filter((s: MaintenanceSchedule) => s.scheduledDate === selectedDateStr)
      .map((s: MaintenanceSchedule) => ({ ...s, isPreventive: true })),
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "bg-rose-500 text-white";
      case "high":
        return "bg-warning text-white";
      case "medium":
        return "bg-blue-500 text-white";
      case "low":
        return "bg-success text-white";
      default:
        return "bg-slate-500 text-white";
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "critical":
        return "Critique";
      case "high":
        return "Élevée";
      case "medium":
        return "Moyenne";
      case "low":
        return "Faible";
      default:
        return priority;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-success/10 text-success dark:bg-success/20 dark:text-success border-success/30";
      case "in_progress":
        return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200";
      case "awaiting_parts":
        return "bg-warning/10 text-warning-text dark:bg-warning/20 dark:text-warning-text border-warning/30";
      case "pending":
        return "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200";
      case "overdue":
        return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200";
      case "planned":
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200";
      case "cancelled":
        return "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-300 border-slate-300";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "Terminé";
      case "in_progress":
        return "En cours";
      case "awaiting_parts":
        return "Attente pièces";
      case "pending":
        return "En attente";
      case "cancelled":
        return "Annulé";
      case "planned":
        return "Planifié";
      case "overdue":
        return "En retard";
      default:
        return status;
    }
  };

  const resolutionRate = performanceStats
    ? Math.round(
        ((performanceStats as any).completed /
          Math.max(
            (performanceStats as any).pending +
              (performanceStats as any).inProgress +
              (performanceStats as any).completed +
              (performanceStats as any).cancelled,
            1,
          )) *
          100,
      )
    : 0;

  const gmaoTabItems = [
    {
      value: "calendar",
      label: "Calendrier & Agenda",
      icon: <TabIcon icon={CalendarDays} />,
    },
    {
      value: "overview",
      label: "Vue d'ensemble",
      icon: <TabIcon icon={Gauge} />,
    },
    {
      value: "assignments",
      label: "Affectations Équipe",
      icon: <TabIcon icon={Users} />,
    },
    {
      value: "analytics",
      label: "Analyses & Résolution",
      icon: <TabIcon icon={TrendingUp} />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header Card Planning & Calendrier GMAO */}
      <HeaderCard
        moduleLabel="Maintenance · Atelier"
        title="Planning &amp; Calendrier des Interventions"
        subtitle={
          <>
            Ordonnancement des réparations, planning atelier et contrôle des échéances
            {lastCheckTime && (
              <span className="ml-1 font-semibold text-success dark:text-success">
                · Vérifié à {format(lastCheckTime, "HH:mm", { locale: fr })}
              </span>
            )}
          </>
        }
        icon={<CalendarDays className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => checkAllMaintenanceMutation.mutate()}
              disabled={isChecking}
              variant="outline"
              size="sm"
              className="rounded-xl border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? "animate-spin text-success" : ""}`} />
              {isChecking ? "Synchronisation…" : "Vérifier échéances"}
            </Button>

            {user?.role === "admin" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30 gap-1.5"
                    disabled={deletePendingMutation.isPending || stats.unassignedWorkOrders === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Purger OT
                    {stats.unassignedWorkOrders > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700">
                        {stats.unassignedWorkOrders}
                      </span>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-rose-600" />
                      Supprimer les OT non assignés
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Tous les ordres de travail <strong>"En attente"</strong> sans technicien seront supprimés définitivement.
                      <br /><br />
                      <span className="font-semibold text-rose-600">
                        {stats.unassignedWorkOrders} ordre(s) concerné(s) · action irréversible.
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deletePendingMutation.mutate()}
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button
              size="sm"
              onClick={() => setLocation("/maintenance/work-orders/new")}
              className="bg-success hover:bg-success text-white font-semibold rounded-xl shadow-xs gap-1.5 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Créer un OT
            </Button>
          </div>
        }
      >
        <KpiGrid columns={6}>
          <KpiTile
            label="Total OT atelier"
            value={stats.totalWorkOrders}
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-success/10 text-success"
            onClick={() => setLocation("/maintenance/work-orders")}
          />
          <KpiTile
            label="En attente"
            value={stats.pendingWorkOrders}
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-warning/10 text-warning-text"
            valueClassName={stats.pendingWorkOrders > 0 ? "text-warning-text" : undefined}
            onClick={() => setLocation("/maintenance/work-orders?status=pending")}
          />
          <KpiTile
            label="En cours"
            value={stats.inProgressWorkOrders}
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
            valueClassName={stats.inProgressWorkOrders > 0 ? "text-blue-600" : undefined}
            onClick={() => setLocation("/maintenance/work-orders?status=in_progress")}
          />
          <KpiTile
            label="Non assignées"
            value={stats.unassignedWorkOrders}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
            valueClassName={stats.unassignedWorkOrders > 0 ? "text-orange-600" : undefined}
          />
          <KpiTile
            label="En retard"
            value={schedulesFailed ? "Indisponible" : stats.overdueSchedules}
            icon={<CalendarDays className="h-4 w-4" />}
            iconWrapperClassName="bg-rose-50 text-rose-600"
            valueClassName={!schedulesFailed && stats.overdueSchedules > 0 ? "text-rose-600" : undefined}
            onClick={() => setLocation("/maintenance/preventive")}
          />
          <KpiTile
            label="Techniciens"
            value={stats.availableTechnicians}
            icon={<Users className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
            onClick={() => setLocation("/technicians")}
          />
        </KpiGrid>
      </HeaderCard>

      {/* Alertes d'état de synchronisation */}
      {checkAllMaintenanceMutation.isSuccess && checkAllMaintenanceMutation.data && (
        <div className="p-4 rounded-2xl bg-success/10 dark:bg-success/20 border border-success/30 flex items-center justify-between text-xs text-success dark:text-success">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            <span>{checkAllMaintenanceMutation.data.message}</span>
          </div>
          {checkAllMaintenanceMutation.data.details?.total > 0 && (
            <span className="font-bold">
              +{checkAllMaintenanceMutation.data.details.total} OT préventifs générés
            </span>
          )}
        </div>
      )}

      {/* 2. Onglets Bento de Planning & Supervision */}
      <Tabs value={activeView} onValueChange={setActiveView} className="space-y-6">
        <PremiumTabsNav tabs={gmaoTabItems} />

        {/* ========================================================================= */}
        {/* ONGLET 1 : Calendrier & Agenda Quotidien                                   */}
        {/* ========================================================================= */}
        <TabsContent value="calendar" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Colonne Gauche : Sélecteur de Calendrier */}
            <div className="lg:col-span-1 p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <CalendarDays className="h-4 w-4 text-success" />
                <span className="text-sm font-bold text-foreground">Sélecteur de Date</span>
              </div>
              <p className="text-xs text-muted-foreground">Cliquez sur un jour pour filtrer l'agenda de l'atelier</p>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                locale={fr}
                className="rounded-2xl border border-slate-100 dark:border-slate-800 w-full p-2 bg-slate-50/50 dark:bg-slate-900/50"
              />
            </div>

            {/* Colonne Droite : Interventions du jour sélectionné */}
            <div className="lg:col-span-2 p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-success" />
                    <span className="text-sm font-bold text-foreground">
                      {selectedDate ? format(selectedDate, "EEEE dd MMMM yyyy", { locale: fr }) : "Date sélectionnée"}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-success/10 dark:bg-success/20 text-success dark:text-success border border-success/30">
                    {dayInterventions.length} intervention{dayInterventions.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {dayInterventions.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 border border-dashed border-slate-200 dark:border-slate-700">
                    <CalendarCheck className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-xs font-semibold text-foreground">Aucune intervention programmée ce jour</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sélectionnez une autre date sur le calendrier ou planifiez un nouvel ordre de travail.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                    {dayInterventions.map((intervention: any) => (
                      <div
                        key={`${intervention.vehicleId || "schedule"}-${intervention.id}`}
                        className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 hover:bg-slate-100/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-foreground">{intervention.title}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                intervention.isPreventive
                                  ? "text-blue-700 bg-blue-50 border-blue-200"
                                  : "text-warning-text bg-warning/10 border-warning/30"
                              }`}
                            >
                              {intervention.isPreventive ? "Préventive" : "Corrective"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Véhicule :{" "}
                            <span className="font-semibold text-foreground">
                              {intervention.vehicleRegistrationNumber || intervention.vehicleRegistration || `#${intervention.vehicleId}`}
                            </span>
                            {intervention.technicianName && (
                              <span className="ml-2">· Technicien : {intervention.technicianName}</span>
                            )}
                            {intervention.estimatedDuration && (
                              <span className="ml-2">· Durée est. : {intervention.estimatedDuration} h</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {intervention.priority && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getPriorityColor(
                                intervention.priority,
                              )}`}
                            >
                              {getPriorityLabel(intervention.priority)}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadge(
                              intervention.status,
                            )}`}
                          >
                            {getStatusLabel(intervention.status)}
                          </span>
                          {intervention.id && (
                            <Link href={`/maintenance/work-orders/${intervention.id}`}>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg">
                                <ArrowRight className="h-4 w-4 text-slate-500" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-muted-foreground">
                <span>Cliquez sur un OT pour ouvrir le suivi détaillé d'intervention</span>
                <Link href="/maintenance/work-orders/new">
                  <span className="text-success font-bold hover:underline cursor-pointer flex items-center gap-1">
                    <Plus className="h-3.5 w-3.5" /> Ajouter à cette date
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 2 : Vue d'ensemble (Urgences, Non assignés, Préventif)            */}
        {/* ========================================================================= */}
        <TabsContent value="overview" className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Carte 1 : Urgences */}
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Interventions Urgentes
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                    {workOrders.filter((wo: WorkOrder) => wo.priority === "critical" || wo.priority === "high").length}
                  </span>
                </div>

                <div className="space-y-2">
                  {workOrders
                    .filter((wo: WorkOrder) => wo.priority === "critical" || wo.priority === "high")
                    .slice(0, 4)
                    .map((wo: WorkOrder) => (
                      <div key={wo.id} className="p-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
                        <p className="text-xs font-bold text-foreground truncate">{wo.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {wo.vehicleRegistrationNumber || `#${wo.vehicleId}`} · {getPriorityLabel(wo.priority)}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Carte 2 : À Assigner */}
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-warning-text dark:text-warning-text flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-warning-text" /> À Assigner
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning/10 text-warning-text border border-warning/30">
                    {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length}
                  </span>
                </div>

                <div className="space-y-2">
                  {workOrders
                    .filter((wo: WorkOrder) => !wo.technicianId)
                    .slice(0, 4)
                    .map((wo: WorkOrder) => (
                      <div key={wo.id} className="p-2.5 rounded-xl bg-warning/10 dark:bg-warning/20 border border-warning/20 dark:border-warning/30 flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-foreground truncate">{wo.title}</p>
                          <p className="text-[11px] text-muted-foreground">{wo.vehicleRegistrationNumber || `#${wo.vehicleId}`}</p>
                        </div>
                        <Link href="/maintenance/work-orders">
                          <Button size="sm" className="h-6 text-[10px] px-2 bg-success hover:bg-success text-white rounded-lg">
                            Assigner
                          </Button>
                        </Link>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Carte 3 : Maintenances Préventives */}
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                    <CalendarCheck className="h-3.5 w-3.5 text-blue-600" /> Échéances Programmées
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    {schedulesFailed ? "—" : schedules.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {schedulesFailed && (
                    <InlineQueryError
                      error={schedulesError}
                      fallback="Le planning de maintenance est momentanément indisponible."
                      onRetry={() => void refetchSchedules()}
                    />
                  )}
                  {schedules.slice(0, 4).map((schedule: MaintenanceSchedule) => (
                    <div key={schedule.id} className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40">
                      <p className="text-xs font-bold text-foreground truncate">{schedule.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {schedule.vehicleRegistrationNumber} · {format(new Date(schedule.scheduledDate), "dd/MM/yyyy", { locale: fr })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 3 : Affectations & Charge par Technicien                            */}
        {/* ========================================================================= */}
        <TabsContent value="assignments" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Charge des techniciens */}
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-bold text-foreground">Charge de Travail par Technicien</span>
              </div>
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {technicians.map((tech: any) => {
                  const techTasks = workOrders.filter(
                    (wo: WorkOrder) =>
                      wo.technicianId === tech.id && (wo.status === "in_progress" || wo.status === "pending"),
                  );
                  const isOpen = selectedTechnician === tech.id;
                  return (
                    <div key={tech.id} className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/40">
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-100/60 transition-colors"
                        onClick={() => setSelectedTechnician(isOpen ? null : tech.id)}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 font-bold text-xs flex items-center justify-center">
                            {(tech.name || tech.username || "T").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-xs text-foreground">{tech.name}</p>
                            <p className="text-[10px] text-muted-foreground">{techTasks.length} tâche(s) active(s)</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                            {tech.role === "workshop_manager" ? "Chef d'atelier" : "Technicien"}
                          </span>
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                        </div>
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 pt-2">
                          {techTasks.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-1">Aucune tâche assignée actuellement</p>
                          ) : (
                            techTasks.map((task: WorkOrder) => (
                              <div key={task.id} className="p-2.5 rounded-xl bg-card dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-bold text-foreground">{task.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{task.vehicleRegistration || `#${task.vehicleId}`}</p>
                                </div>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${getPriorityColor(task.priority)}`}>
                                  {getPriorityLabel(task.priority)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Interventions à affecter */}
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-text" />
                  <span className="text-sm font-bold text-foreground">File d'Attente sans Technicien</span>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warning/10 text-warning-text border border-warning/30">
                  {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length}
                </span>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {workOrders
                  .filter((wo: WorkOrder) => !wo.technicianId)
                  .map((wo: WorkOrder) => (
                    <div key={wo.id} className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-foreground">{wo.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {wo.vehicleRegistrationNumber || `#${wo.vehicleId}`}
                        </p>
                      </div>
                      <Link href={`/maintenance/work-orders`}>
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-success hover:bg-success text-white rounded-xl">
                          Assigner
                        </Button>
                      </Link>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ONGLET 4 : Analyses & Performance                                         */}
        {/* ========================================================================= */}
        <TabsContent value="analytics" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                <span className="text-sm font-bold text-foreground">Performance de Clôture &amp; Délais</span>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5 text-xs">
                  <span className="text-muted-foreground">Taux de résolution globale</span>
                  <span className="font-extrabold text-success">{resolutionRate}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{ width: `${resolutionRate}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60">
                  <p className="text-[10px] text-rose-700 font-bold uppercase tracking-wider">Échéances en retard</p>
                  <p className="text-2xl font-black text-rose-700 dark:text-rose-400 mt-0.5">{schedulesFailed ? "Indisponible" : stats.overdueSchedules}</p>
                </div>
                <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60">
                  <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">Délai moyen résolution</p>
                  <p className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-0.5">
                    {performanceStats ? Math.round((performanceStats as any).avgResolutionTime || 0) : 0}
                    <span className="text-sm font-semibold ml-1">j</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-3xl bg-card dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-text" />
                <span className="text-sm font-bold text-foreground">Répartition par Niveau de Priorité</span>
              </div>

              <div className="space-y-3">
                {["critical", "high", "medium", "low"].map((priority) => {
                  const count = workOrders.filter((wo: WorkOrder) => wo.priority === priority).length;
                  const percentage = workOrders.length > 0 ? (count / workOrders.length) * 100 : 0;
                  const colors: Record<string, string> = {
                    critical: "bg-rose-500",
                    high: "bg-warning",
                    medium: "bg-blue-500",
                    low: "bg-success",
                  };
                  return (
                    <div key={priority} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{getPriorityLabel(priority)}</span>
                        <span className="font-bold text-foreground">
                          {count} ({Math.round(percentage)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full rounded-full ${colors[priority]}`} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
