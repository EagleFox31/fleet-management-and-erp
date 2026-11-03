import { userMessageOf } from "@/lib/api-error";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { formatDate, translateStatus } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Play, ClipboardCheck, FileText, Package, Plus, UserPlus, Search, Eye,
} from "lucide-react";
import { WorkOrderEditModal } from "./work-order-edit-modal";
import { useVehicle } from "@/context/vehicle-context";
import { useAuth } from "@/hooks/useAuth";
import { appToast, invalidateAlertQueries } from "@/lib/app-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface WorkOrder {
  id: number;
  vehicleId: number;
  vehicleRegistration?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  technicianId: number | null;
  technicianName?: string;
  title: string;
  description: string | null;
  diagnosis: string | null;
  status: "pending" | "in_progress" | "awaiting_parts" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  startDate: string | null;
  endDate: string | null;
  isPreventive: boolean;
  maintenanceScheduleId?: number | null;
  isFirstVisit?: boolean;
  vehicle?: { registrationNumber: string; brand: string; model: string };
  technician?: { name: string };
}

interface WorkOrdersResponse {
  workOrders: WorkOrder[];
  total: number;
}

interface WorkOrderTableProps {
  onRowClick?: (workOrder: WorkOrder) => void;
  vehicleId?: number;
  initialStatusFilter?: string | null;
  compact?: boolean;
  /** Masque la barre d'outils (recherche, filtres, bouton) quand le parent fournit déjà un en-tête */
  hideToolbar?: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  awaiting_parts: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-gray-100 text-gray-500",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critique",
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};

function getWorkOrderOrigin(workOrder: WorkOrder) {
  const title = (workOrder.title || "").toLowerCase();
  if (workOrder.maintenanceScheduleId) {
    return { label: "Échéance préventive (planification)", className: "bg-blue-100 text-blue-700" };
  }
  if (workOrder.isPreventive) {
    if (title.includes("kilométr")) return { label: "Échéance préventive (km)", className: "bg-indigo-100 text-indigo-700" };
    if (title.includes("maintenance préventive programmée")) return { label: "Échéance préventive (date)", className: "bg-sky-100 text-sky-700" };
    if (title.includes("assurance") || title.includes("contrôle technique") || title.includes("immatriculation") || title.includes("plaque")) {
      return { label: "Conformité documentaire", className: "bg-amber-100 text-amber-700" };
    }
    return { label: "Préventive", className: "bg-blue-100 text-blue-700" };
  }
  return { label: "Corrective / panne", className: "bg-orange-100 text-orange-700" };
}

export function WorkOrderTable({ onRowClick, vehicleId, initialStatusFilter, hideToolbar }: WorkOrderTableProps) {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTargetWorkOrder, setAssignTargetWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
  const [autoStartingWorkOrderId, setAutoStartingWorkOrderId] = useState<number | null>(null);
  const { setSelectedVehicle } = useVehicle();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const itemsPerPage = 10;
  const canAssignTechnician = user?.role === "admin" || user?.role === "workshop_manager";

  useEffect(() => {
    setStatusFilter(initialStatusFilter || "");
    setCurrentPage(1);
  }, [initialStatusFilter]);

  const { data, isLoading } = useQuery<any>({
    queryKey: vehicleId
      ? [`/api/work-orders/vehicle/${vehicleId}`]
      : ["/api/work-orders", { search: searchTerm, status: statusFilter, priority: priorityFilter, limit: itemsPerPage, offset: (currentPage - 1) * itemsPerPage }],
    staleTime: 0,
    refetchInterval: vehicleId ? false : 7000,
    refetchIntervalInBackground: true,
  });

  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ["/api/users/technicians"],
    enabled: canAssignTechnician,
    staleTime: 60 * 1000,
  });

  const assignTechnicianMutation = useMutation({
    mutationFn: async ({ workOrderId, technicianId }: { workOrderId: number; technicianId: number }) => {
      await apiRequest("PATCH", `/api/work-orders/${workOrderId}`, { technicianId });
    },
    onSuccess: async (_data, variables) => {
      const vehicleIdToRefresh = assignTargetWorkOrder?.vehicleId ?? vehicleId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${variables.workOrderId}`] }),
        ...(vehicleIdToRefresh
          ? [queryClient.invalidateQueries({ queryKey: [`/api/work-orders/vehicle/${vehicleIdToRefresh}`] })]
          : []),
      ]);
      invalidateAlertQueries();
      appToast({
        title: "Technicien assigné",
        description: "Le technicien a été notifié dans sa cloche d'alertes.",
        variant: "success",
      });
      setAssignModalOpen(false);
      setAssignTargetWorkOrder(null);
      setSelectedTechnicianId("");
    },
    onError: (error: any) => {
      appToast({
        title: "Échec de l'assignation",
        description: userMessageOf(error, "Impossible d'assigner ce technicien."),
        variant: "destructive",
      });
    },
  });

  const autoAssignAndStartMutation = useMutation({
    mutationFn: async (workOrderId: number) => {
      if (!user?.id) throw new Error("Utilisateur non authentifié");
      await apiRequest("PATCH", `/api/work-orders/${workOrderId}`, {
        technicianId: user.id,
        status: "in_progress",
        startDate: new Date().toISOString(),
      });
    },
    onMutate: (workOrderId) => { setAutoStartingWorkOrderId(workOrderId); },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] }),
      ]);
      appToast({ title: "OT démarré", description: "L'ordre de travail a été auto-assigné et démarré.", variant: "success" });
    },
    onError: (error: any) => {
      appToast({ title: "Échec du démarrage", description: userMessageOf(error, "Impossible de démarrer cet OT."), variant: "destructive" });
    },
    onSettled: () => { setAutoStartingWorkOrderId(null); },
  });

  const workOrders = vehicleId
    ? (data || []) as WorkOrder[]
    : ((data as WorkOrdersResponse)?.workOrders || []);
  const totalWorkOrders = vehicleId ? workOrders.length : ((data as WorkOrdersResponse)?.total || 0);
  const totalPages = Math.ceil(totalWorkOrders / itemsPerPage);

  const openAssignModal = (workOrder: WorkOrder) => {
    setAssignTargetWorkOrder(workOrder);
    setSelectedTechnicianId(workOrder.technicianId ? String(workOrder.technicianId) : "");
    setAssignModalOpen(true);
  };

  const handleAssignTechnician = () => {
    if (!assignTargetWorkOrder) return;
    if (!selectedTechnicianId) {
      appToast({ title: "Technicien requis", description: "Sélectionnez un technicien pour continuer.", variant: "destructive" });
      return;
    }
    const technicianId = Number(selectedTechnicianId);
    if (!Number.isFinite(technicianId) || technicianId <= 0) {
      appToast({ title: "Technicien invalide", description: "La sélection du technicien est invalide.", variant: "destructive" });
      return;
    }
    assignTechnicianMutation.mutate({ workOrderId: assignTargetWorkOrder.id, technicianId });
  };

  const handleAutoAssignAndStart = (workOrderId: number) => {
    if (!user?.id) {
      appToast({ title: "Session invalide", description: "Reconnectez-vous puis réessayez.", variant: "destructive" });
      return;
    }
    autoAssignAndStartMutation.mutate(workOrderId);
  };

  const handleAddWorkOrder = () => {
    const baseUrl = "/maintenance/work-orders/new";
    setLocation(vehicleId ? `${baseUrl}?vehicleId=${vehicleId}` : baseUrl);
  };

  const handleRowClick = (workOrder: WorkOrder) => {
    if (workOrder.vehicleRegistration || workOrder.vehicle?.registrationNumber) {
      setSelectedVehicle({
        id: workOrder.vehicleId,
        registrationNumber: workOrder.vehicleRegistration || workOrder.vehicle?.registrationNumber || "",
        brand: workOrder.vehicleBrand || workOrder.vehicle?.brand,
        model: workOrder.vehicleModel || workOrder.vehicle?.model,
      });
    }
    if (onRowClick) {
      onRowClick(workOrder);
    } else {
      setLocation(`/maintenance/work-orders/${workOrder.id}`);
    }
  };

  const renderActions = (wo: WorkOrder) => {
    if (user?.role === "client") {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}`); }}
          className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
          data-testid={`btn-view-${wo.id}`}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      );
    }

    switch (wo.status) {
      case "pending":
        return (
          <div className="flex gap-1">
            {canAssignTechnician && !wo.technicianId && (
              <button
                onClick={(e) => { e.stopPropagation(); openAssignModal(wo); }}
                className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition-colors"
                data-testid={`btn-assign-${wo.id}`}
                title="Assigner"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            )}
            {canAssignTechnician ? (
              !wo.technicianId ? (
                <button
                  onClick={(e) => { e.stopPropagation(); handleAutoAssignAndStart(wo.id); }}
                  disabled={autoStartingWorkOrderId === wo.id}
                  className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors disabled:opacity-50"
                  data-testid={`btn-start-auto-assign-${wo.id}`}
                  title="Commencer"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}`); }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                  data-testid={`btn-view-pending-${wo.id}`}
                  title="Voir OT"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              )
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}?action=start`); }}
                className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                data-testid={`btn-start-${wo.id}`}
                title="Commencer"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );

      case "in_progress":
        return (
          <div className="flex gap-1">
            {canAssignTechnician && (
              <button
                onClick={(e) => { e.stopPropagation(); openAssignModal(wo); }}
                className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition-colors"
                data-testid={`btn-reassign-${wo.id}`}
                title="Réassigner"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}?tab=parts`); }}
              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
              data-testid={`btn-plan-${wo.id}`}
              title="Planifier pièces"
            >
              <Package className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}?action=complete`); }}
              className="p-1.5 rounded-lg hover:bg-orange-50 text-orange-600 transition-colors"
              data-testid={`btn-complete-${wo.id}`}
              title="Terminer l'OT"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
            </button>
          </div>
        );

      case "awaiting_parts":
        return (
          <div className="flex gap-1">
            {canAssignTechnician && (
              <button
                onClick={(e) => { e.stopPropagation(); openAssignModal(wo); }}
                className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition-colors"
                data-testid={`btn-assign-awaiting-${wo.id}`}
                title={wo.technicianId ? "Réassigner" : "Assigner"}
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}?tab=parts`); }}
              className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 transition-colors"
              data-testid={`btn-parts-${wo.id}`}
              title="Voir pièces"
            >
              <Package className="h-3.5 w-3.5" />
            </button>
          </div>
        );

      case "completed":
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setLocation(`/maintenance/work-orders/${wo.id}?tab=report`); }}
            className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-600 transition-colors"
            data-testid={`btn-report-${wo.id}`}
            title="Rapport"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        );

      case "cancelled":
        return <span className="text-xs text-gray-400 italic">Annulé</span>;

      default:
        return null;
    }
  };

  return (
    <div>
      {/* ── Toolbar ── */}
      {!hideToolbar && (
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-col md:flex-row gap-3 items-start md:items-center">
        {!vehicleId && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              placeholder="Rechercher un ordre de travail..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              data-testid="input-search-work-orders"
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
            />
          </div>
        )}
        {!vehicleId && (
          <div className="flex gap-2 flex-wrap">
            <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : v); setCurrentPage(1); }}>
              <SelectTrigger className="h-8 text-xs border-gray-100 bg-gray-50 w-36" data-testid="select-status-filter">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
                <SelectItem value="in_progress">En cours</SelectItem>
                <SelectItem value="awaiting_parts">Attente pièces</SelectItem>
                <SelectItem value="completed">Terminé</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter || "all"} onValueChange={(v) => { setPriorityFilter(v === "all" ? "" : v); setCurrentPage(1); }}>
              <SelectTrigger className="h-8 text-xs border-gray-100 bg-gray-50 w-36" data-testid="select-priority-filter">
                <SelectValue placeholder="Toutes priorités" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes priorités</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="low">Faible</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {vehicleId && user?.role !== "client" && (
          <Button size="sm" onClick={handleAddWorkOrder} className="gap-2 h-8 text-xs ml-auto">
            <Plus className="h-3.5 w-3.5" /> Ajouter un OT
          </Button>
        )}
        <span className="ml-auto text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
          {totalWorkOrders}
        </span>
      </div>
      )}

      {/* ── Table ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500" />
        </div>
      ) : workOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
            <ClipboardCheck className="h-5 w-5 text-gray-300" />
          </div>
          <p className="text-sm font-medium text-gray-500">Aucun ordre de travail trouvé</p>
          <p className="text-xs text-gray-400 mt-1">Ajustez les filtres ou créez un nouvel OT</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-work-orders">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Titre / Origine</th>
                {!vehicleId && (
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Véhicule</th>
                )}
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Technicien</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Priorité</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Statut</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Type</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Date</th>
                <th className="px-4 py-3" data-help-target="wo-table-actions" />
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => {
                const origin = getWorkOrderOrigin(wo);
                const isAwaitingParts = wo.status === "awaiting_parts";
                return (
                  <tr
                    key={wo.id}
                    onClick={() => handleRowClick(wo)}
                    data-testid={`row-work-order-${wo.id}`}
                    className={`group border-b border-gray-50 last:border-0 transition-colors cursor-pointer border-l-2 ${
                      isAwaitingParts
                        ? "border-l-amber-400 bg-amber-50/30 hover:bg-amber-50/60"
                        : "border-l-transparent hover:bg-gray-50/60"
                    }`}
                  >
                    {/* Titre */}
                    <td className="px-5 py-3.5 max-w-[260px]">
                      <p className="text-sm font-semibold text-gray-800 truncate">{wo.title}</p>
                      <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${origin.className}`}>
                        {origin.label}
                      </span>
                      {wo.isFirstVisit && (
                        <span className="ml-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          Première visite
                        </span>
                      )}
                    </td>

                    {/* Véhicule */}
                    {!vehicleId && (
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-medium text-gray-700">
                          {(wo as any).vehicleRegistrationNumber || wo.vehicleRegistration || wo.vehicle?.registrationNumber || `#${wo.vehicleId}`}
                        </p>
                        <p className="text-xs text-gray-400">
                          {(wo as any).vehicleBrand || wo.vehicle?.brand} {(wo as any).vehicleModel || wo.vehicle?.model}
                        </p>
                      </td>
                    )}

                    {/* Technicien */}
                    <td className="px-4 py-3.5 text-xs text-gray-600">
                      {wo.technicianName || wo.technician?.name || (wo.technicianId ? `#${wo.technicianId}` : (
                        <span className="text-gray-300">Non assigné</span>
                      ))}
                    </td>

                    {/* Priorité */}
                    <td className="px-4 py-3.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_BADGE[wo.priority] || "bg-gray-100 text-gray-500"}`}>
                        {PRIORITY_LABELS[wo.priority] || wo.priority}
                      </span>
                    </td>

                    {/* Statut */}
                    <td className="px-4 py-3.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[wo.status] || "bg-gray-100 text-gray-500"}`}>
                        {translateStatus(wo.status)}
                      </span>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${wo.isPreventive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                        {wo.isPreventive ? "Préventif" : "Correctif"}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      <div>{formatDate(wo.startDate ?? undefined)}</div>
                      {wo.endDate && <div className="text-gray-400">Fin: {formatDate(wo.endDate)}</div>}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end flex">
                        {renderActions(wo)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {!vehicleId && totalPages > 1 && (
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">{totalWorkOrders} ordres de travail</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Préc.
            </button>
            <span className="text-xs text-gray-500 font-medium">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Suiv.
            </button>
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {selectedWorkOrder && (
        <WorkOrderEditModal
          workOrder={selectedWorkOrder}
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
        />
      )}

      {/* ── Assign dialog ── */}
      <Dialog
        open={assignModalOpen}
        onOpenChange={(open) => {
          setAssignModalOpen(open);
          if (!open) { setAssignTargetWorkOrder(null); setSelectedTechnicianId(""); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assigner un technicien</DialogTitle>
            <DialogDescription>
              {assignTargetWorkOrder ? `OT #${assignTargetWorkOrder.id} — ${assignTargetWorkOrder.title}` : "Sélectionnez un technicien pour cet ordre de travail."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">Technicien</div>
            <Select value={selectedTechnicianId} onValueChange={setSelectedTechnicianId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un technicien" />
              </SelectTrigger>
              <SelectContent>
                {technicians.map((technician: any) => (
                  <SelectItem key={technician.id} value={String(technician.id)}>
                    {technician.name || technician.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignModalOpen(false); setAssignTargetWorkOrder(null); setSelectedTechnicianId(""); }}>
              Annuler
            </Button>
            <Button onClick={handleAssignTechnician} disabled={assignTechnicianMutation.isPending || !selectedTechnicianId}>
              {assignTechnicianMutation.isPending ? "Assignation..." : "Assigner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
