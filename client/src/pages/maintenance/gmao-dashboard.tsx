import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Calendar as CalendarIcon,
  Plus,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Gauge,
  Trash2
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { HeaderCard, KpiGrid, KpiTile, PremiumTabsNav } from "@/components/design-system";
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
  status: "pending" | "in_progress" | "completed" | "cancelled";
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
  const [activeView, setActiveView] = useState("overview");
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
    queryKey: ['/api/work-orders'],
  });

  const { data: schedulesData } = useQuery<any>({
    queryKey: ['/api/maintenance-schedules'],
  });

  const { data: usersData } = useQuery<any>({
    queryKey: ['/api/users'],
  });

  // Charger les statistiques de performance depuis la BDD
  const { data: performanceStats } = useQuery<any>({
    queryKey: ['/api/work-orders/statistics'],
  });

  const workOrders = Array.isArray(workOrdersData) ? workOrdersData : (workOrdersData?.workOrders || []);
  const schedules = Array.isArray(schedulesData) ? schedulesData : [];
  const technicians = Array.isArray(usersData) ? usersData.filter((user: any) => user.role === 'technician' || user.role === 'workshop_manager') : [];

  // Mutation pour vérifier toutes les maintenances
  const checkAllMaintenanceMutation = useMutation({
    mutationFn: async () => {
      setIsChecking(true);
      const response = await fetch("/api/check-all-maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        throw new Error('Erreur lors de la vérification');
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
      console.error('Erreur:', error);
    },
    onSettled: () => {
      setIsChecking(false);
    }
  });

  // Statistiques rapides
  const stats = {
    totalWorkOrders: workOrders.length,
    pendingWorkOrders: workOrders.filter((wo: WorkOrder) => wo.status === 'pending').length,
    inProgressWorkOrders: workOrders.filter((wo: WorkOrder) => wo.status === 'in_progress').length,
    unassignedWorkOrders: workOrders.filter((wo: WorkOrder) => !wo.technicianId).length,
    overdueSchedules: schedules.filter((s: MaintenanceSchedule) => s.status === 'overdue').length,
    availableTechnicians: technicians.length,
  };

  // Interventions du jour sélectionné
  const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const dayInterventions = [
    // Work orders (correctives si non planifiées, préventives si planifiées)
    ...workOrders.filter((wo: WorkOrder) => 
      wo.scheduledDate === selectedDateStr || 
      (!wo.scheduledDate && format(new Date(wo.createdAt), 'yyyy-MM-dd') === selectedDateStr)
    ).map((wo: WorkOrder) => ({ ...wo, isPreventive: !!wo.scheduledDate })),
    // Maintenances préventives planifiées (toujours préventives)
    ...schedules.filter((s: MaintenanceSchedule) => s.scheduledDate === selectedDateStr)
      .map((s: MaintenanceSchedule) => ({ ...s, isPreventive: true }))
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical': return 'Critique';
      case 'high': return 'Élevée';
      case 'medium': return 'Moyenne';
      case 'low': return 'Faible';
      default: return priority;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'in_progress': return 'bg-blue-500';
      case 'pending': return 'bg-orange-500';
      case 'overdue': return 'bg-red-500';
      case 'cancelled': return 'bg-black';
      default: return 'bg-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'Terminé';
      case 'in_progress': return 'En cours';
      case 'pending': return 'En attente';
      case 'cancelled': return 'Annulé';
      case 'planned': return 'Planifié';
      case 'overdue': return 'En retard';
      default: return status;
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
            1
          )) * 100
      )
    : 0;

  const gmaoTabItems = [
    {
      value: "overview",
      label: "Vue d'ensemble",
      icon: <TabIcon icon={Gauge} />,
    },
    {
      value: "calendar",
      label: "Calendrier",
      icon: <TabIcon icon={CalendarDays} />,
    },
    {
      value: "assignments",
      label: "Affectations",
      icon: <TabIcon icon={Users} />,
    },
    {
      value: "analytics",
      label: "Analyses",
      icon: <TabIcon icon={TrendingUp} />,
    },
  ];

  return (
    <div className="space-y-6">
      <HeaderCard
        moduleLabel="Maintenance"
        title="Tableau de bord Maintenance"
        subtitle={
          <>
            Suivi global · interventions correctives et préventives
            {lastCheckTime && (
              <span className="ml-1">· Vérifié à {format(lastCheckTime, "HH:mm", { locale: fr })}</span>
            )}
          </>
        }
        icon={<Gauge className="h-5 w-5" />}
        actions={
          <>
            <Button
              onClick={() => checkAllMaintenanceMutation.mutate()}
              disabled={isChecking}
              variant="outline"
              size="sm"
              className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? "animate-spin" : ""}`} />
              {isChecking ? "Vérification..." : "Vérifier"}
            </Button>

            {user?.role === "admin" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
                    disabled={deletePendingMutation.isPending || stats.unassignedWorkOrders === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Purger OT
                    {stats.unassignedWorkOrders > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-600">
                        {stats.unassignedWorkOrders}
                      </span>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-red-500" />
                      Supprimer les OT non assignés
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Tous les ordres de travail <strong>"En attente"</strong> sans technicien seront supprimés définitivement.
                      <br /><br />
                      <span className="font-semibold text-red-600">
                        {stats.unassignedWorkOrders} ordre(s) concerné(s) · action irréversible.
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deletePendingMutation.mutate()}
                      className="bg-red-600 hover:bg-red-700 text-white"
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
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle intervention
            </Button>
          </>
        }
      >
        <KpiGrid columns={6}>
          <KpiTile
            label="Total OT"
            value={stats.totalWorkOrders}
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            label="En attente"
            value={stats.pendingWorkOrders}
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-amber-50 text-amber-500"
            valueClassName={stats.pendingWorkOrders > 0 ? "text-amber-700" : undefined}
          />
          <KpiTile
            label="En cours"
            value={stats.inProgressWorkOrders}
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-500"
            valueClassName={stats.inProgressWorkOrders > 0 ? "text-blue-700" : undefined}
          />
          <KpiTile
            label="Non assignées"
            value={stats.unassignedWorkOrders}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-500"
            valueClassName={stats.unassignedWorkOrders > 0 ? "text-orange-700" : undefined}
          />
          <KpiTile
            label="En retard"
            value={stats.overdueSchedules}
            icon={<CalendarDays className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-500"
            valueClassName={stats.overdueSchedules > 0 ? "text-red-700" : undefined}
          />
          <KpiTile
            label="Techniciens"
            value={stats.availableTechnicians}
            icon={<Users className="h-4 w-4" />}
            iconWrapperClassName="bg-violet-50 text-violet-500"
          />
        </KpiGrid>
      </HeaderCard>

      {/* ── Alertes mutation ── */}
      {deletePendingMutation.isSuccess && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700">
            {(deletePendingMutation.data as any)?.message || "Suppression effectuée avec succès."}
          </AlertDescription>
        </Alert>
      )}
      {deletePendingMutation.isError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700">Erreur lors de la suppression des ordres de travail.</AlertDescription>
        </Alert>
      )}
      {checkAllMaintenanceMutation.isError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <AlertDescription className="text-red-700">Erreur lors de la vérification des maintenances.</AlertDescription>
        </Alert>
      )}
      {checkAllMaintenanceMutation.isSuccess && checkAllMaintenanceMutation.data && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700">
            {checkAllMaintenanceMutation.data.message}
            {checkAllMaintenanceMutation.data.details?.total > 0 && (
              <div className="mt-1 text-sm">
                · Kilométrique : {checkAllMaintenanceMutation.data.details.kilometerBased.workOrdersCreated} ordres
                &nbsp;· Date : {checkAllMaintenanceMutation.data.details.dateBased.workOrdersCreated} ordres
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Tabs ── */}
      <Tabs value={activeView} onValueChange={setActiveView} className="space-y-5">
        <PremiumTabsNav tabs={gmaoTabItems} />

        {/* ── Vue d'ensemble ── */}
        <TabsContent value="overview" className="space-y-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Urgentes */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-red-500 to-rose-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  Interventions urgentes
                  <span className="ml-auto text-xs font-normal text-red-400 bg-red-50 px-2 py-0.5 rounded-full">
                    {workOrders.filter((wo: WorkOrder) => wo.priority === 'critical' || wo.priority === 'high').length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {workOrders.filter((wo: WorkOrder) => wo.priority === 'critical' || wo.priority === 'high').length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center mb-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                    <p className="text-xs text-gray-400">Aucune intervention urgente</p>
                  </div>
                ) : (
                  workOrders
                    .filter((wo: WorkOrder) => wo.priority === 'critical' || wo.priority === 'high')
                    .slice(0, 5)
                    .map((wo: WorkOrder) => (
                      <div key={wo.id} className="flex items-start justify-between gap-2 p-2.5 bg-red-50/60 rounded-lg border border-red-100/60">
                        <div className="min-w-0">
                          <p className="font-medium text-[13px] text-gray-800 truncate">{wo.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{wo.vehicleRegistrationNumber || wo.vehicleRegistration || `#${wo.vehicleId}`}</p>
                          {(wo.vehicleBrand || wo.vehicleModel) && (
                            <p className="text-[11px] text-gray-400">{wo.vehicleBrand} {wo.vehicleModel}</p>
                          )}
                        </div>
                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${getPriorityColor(wo.priority)}`}>
                          {getPriorityLabel(wo.priority)}
                        </span>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            {/* Non assignées */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-orange-500 to-amber-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-orange-50 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-orange-500" />
                  </div>
                  Non assignées
                  <span className="ml-auto text-xs font-normal text-orange-400 bg-orange-50 px-2 py-0.5 rounded-full">
                    {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center mb-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                    <p className="text-xs text-gray-400">Toutes les interventions sont assignées</p>
                  </div>
                ) : (
                  workOrders
                    .filter((wo: WorkOrder) => !wo.technicianId)
                    .slice(0, 5)
                    .map((wo: WorkOrder) => (
                      <div key={wo.id} className="flex items-start justify-between gap-2 p-2.5 bg-orange-50/60 rounded-lg border border-orange-100/60">
                        <div className="min-w-0">
                          <p className="font-medium text-[13px] text-gray-800 truncate">{wo.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{wo.vehicleRegistrationNumber || wo.vehicleRegistration || `#${wo.vehicleId}`}</p>
                          {(wo.vehicleBrand || wo.vehicleModel) && (
                            <p className="text-[11px] text-gray-400">{wo.vehicleBrand} {wo.vehicleModel}</p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" className="shrink-0 h-7 text-[11px] px-2.5">
                          Assigner
                        </Button>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            {/* Maintenance préventive */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-blue-500 to-indigo-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
                    <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  Maintenance préventive
                  <span className="ml-auto text-xs font-normal text-blue-400 bg-blue-50 px-2 py-0.5 rounded-full">
                    {schedules.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {schedules.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center mb-2">
                      <CalendarIcon className="w-4 h-4 text-blue-400" />
                    </div>
                    <p className="text-xs text-gray-400">Aucune planification active</p>
                  </div>
                ) : (
                  schedules.slice(0, 5).map((schedule: MaintenanceSchedule) => (
                    <div key={schedule.id} className="flex items-start justify-between gap-2 p-2.5 bg-blue-50/60 rounded-lg border border-blue-100/60">
                      <div className="min-w-0">
                        <p className="font-medium text-[13px] text-gray-800 truncate">{schedule.title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {schedule.vehicleRegistrationNumber} · {format(new Date(schedule.scheduledDate), 'dd/MM/yyyy', { locale: fr })}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${getStatusColor(schedule.status)}`}>
                        {getStatusLabel(schedule.status)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Calendrier ── */}
        <TabsContent value="calendar" className="space-y-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="lg:col-span-1 overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                    <CalendarDays className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  Calendrier
                </CardTitle>
                <CardDescription className="text-xs text-gray-400">Sélectionnez une date</CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  locale={fr}
                  className="rounded-xl border border-gray-100 w-full"
                />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                    <Wrench className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  {selectedDate ? format(selectedDate, 'dd MMMM yyyy', { locale: fr }) : 'Jour sélectionné'}
                  <span className="ml-auto text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    {dayInterventions.length} intervention{dayInterventions.length !== 1 ? 's' : ''}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {dayInterventions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                      <CalendarDays className="w-5 h-5 text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400">Aucune intervention pour cette date</p>
                  </div>
                ) : (
                  dayInterventions.map((intervention: any) => (
                    <div key={`${intervention.vehicleId || 'schedule'}-${intervention.id}`}
                      className="flex items-start justify-between gap-3 p-3 bg-gray-50/70 rounded-xl border border-gray-100">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-medium text-[13px] text-gray-800">{intervention.title}</p>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${intervention.isPreventive ? 'text-blue-600 border-blue-200 bg-blue-50' : 'text-orange-600 border-orange-200 bg-orange-50'}`}>
                            {intervention.isPreventive ? 'Préventive' : 'Corrective'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          {intervention.vehicleRegistrationNumber}
                          {intervention.technicianName && ` · ${intervention.technicianName}`}
                          {intervention.estimatedDuration && ` · ${intervention.estimatedDuration}h`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {intervention.priority && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${getPriorityColor(intervention.priority)}`}>
                            {getPriorityLabel(intervention.priority)}
                          </span>
                        )}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${getStatusColor(intervention.status)}`}>
                          {getStatusLabel(intervention.status)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Affectations ── */}
        <TabsContent value="assignments" className="space-y-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Techniciens */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-violet-500 to-purple-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-violet-500" />
                  </div>
                  Techniciens
                </CardTitle>
                <CardDescription className="text-xs text-gray-400">Charge de travail par technicien</CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {technicians.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center">Aucun technicien trouvé</p>
                ) : technicians.map((tech: any) => {
                  const techTasks = workOrders.filter((wo: WorkOrder) =>
                    wo.technicianId === tech.id && (wo.status === 'in_progress' || wo.status === 'pending')
                  );
                  const isOpen = selectedTechnician === tech.id;
                  return (
                    <div key={tech.id} className="border border-gray-100 rounded-xl overflow-hidden">
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50/70 transition-colors"
                        onClick={() => setSelectedTechnician(isOpen ? null : tech.id)}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center text-[11px] font-bold text-violet-600">
                            {(tech.name || tech.username || 'T').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-[13px] text-gray-800">{tech.name}</p>
                            <p className="text-[11px] text-gray-400">{techTasks.length} tâche{techTasks.length !== 1 ? 's' : ''} en cours</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100">
                            {tech.role === 'workshop_manager' ? 'Chef d\'atelier' : 'Technicien'}
                          </span>
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                        </div>
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-3 border-t border-gray-50 bg-gray-50/50 space-y-1.5 pt-2">
                          {techTasks.length === 0 ? (
                            <p className="text-xs text-gray-400 py-1">Aucune tâche assignée</p>
                          ) : techTasks.map((task: WorkOrder) => (
                            <div key={task.id} className="bg-white p-2.5 rounded-lg border border-gray-100">
                              <div className="flex justify-between items-start gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-[12px] text-gray-800 truncate">{task.title}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {task.vehicleRegistration || `#${task.vehicleId}`} · Depuis {new Date(task.createdAt).toLocaleDateString('fr-FR')}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-1 shrink-0">
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white ${getPriorityColor(task.priority)}`}>
                                    {getPriorityLabel(task.priority)}
                                  </span>
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white ${getStatusColor(task.status)}`}>
                                    {getStatusLabel(task.status)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* À assigner */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-orange-500 to-amber-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-orange-50 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                  </div>
                  Interventions à assigner
                  <span className="ml-auto text-xs font-normal text-orange-400 bg-orange-50 px-2 py-0.5 rounded-full">
                    {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2">
                {workOrders.filter((wo: WorkOrder) => !wo.technicianId).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center mb-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                    <p className="text-xs text-gray-400">Tout est assigné</p>
                  </div>
                ) : (
                  workOrders.filter((wo: WorkOrder) => !wo.technicianId).map((wo: WorkOrder) => (
                    <div key={wo.id} className="flex items-start justify-between gap-2 p-2.5 bg-orange-50/40 rounded-xl border border-orange-100/60">
                      <div className="min-w-0">
                        <p className="font-medium text-[13px] text-gray-800 truncate">{wo.title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {wo.vehicleRegistrationNumber || wo.vehicleRegistration || `#${wo.vehicleId}`}
                          {(wo.vehicleBrand || wo.vehicleModel) && ` · ${wo.vehicleBrand} ${wo.vehicleModel}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${getPriorityColor(wo.priority)}`}>
                          {getPriorityLabel(wo.priority)}
                        </span>
                        <Button size="sm" className="h-7 text-[11px] px-2.5 bg-green-600 hover:bg-green-700 text-white">
                          Assigner
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Analyses ── */}
        <TabsContent value="analytics" className="space-y-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Performance */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  Performance des interventions
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-4">
                {/* Taux de résolution */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[12px] text-gray-600">Taux de résolution</span>
                    <span className="text-[13px] font-bold text-green-700">{resolutionRate}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
                      style={{ width: `${resolutionRate}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-red-50 rounded-xl p-3 border border-red-100/60">
                    <p className="text-[10px] text-red-500 font-medium uppercase tracking-wide">En retard</p>
                    <p className="text-2xl font-bold text-red-600 mt-0.5">{stats.overdueSchedules}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100/60">
                    <p className="text-[10px] text-blue-500 font-medium uppercase tracking-wide">Temps moyen</p>
                    <p className="text-2xl font-bold text-blue-600 mt-0.5">
                      {performanceStats ? Math.round((performanceStats as any).avgResolutionTime || 0) : 0}
                      <span className="text-sm font-normal ml-1">j</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Répartition par priorité */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-amber-500 to-yellow-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-amber-50 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  Répartition par priorité
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-3">
                {['critical', 'high', 'medium', 'low'].map(priority => {
                  const count = workOrders.filter((wo: WorkOrder) => wo.priority === priority).length;
                  const percentage = workOrders.length > 0 ? (count / workOrders.length) * 100 : 0;
                  const barColors: Record<string, string> = {
                    critical: 'from-red-500 to-rose-400',
                    high: 'from-orange-500 to-amber-400',
                    medium: 'from-yellow-500 to-yellow-400',
                    low: 'from-green-500 to-emerald-400',
                  };
                  return (
                    <div key={priority}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${getPriorityColor(priority)}`} />
                          <span className="text-[12px] text-gray-600">{getPriorityLabel(priority)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-gray-700">{count}</span>
                          <span className="text-[11px] text-gray-400">({Math.round(percentage)}%)</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${barColors[priority]} transition-all`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
