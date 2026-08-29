import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { WorkOrderTable } from "@/components/maintenance/work-order-table";
import { useQuery } from "@tanstack/react-query";
import { Plus, Clock, PlayCircle, CheckCircle, XCircle, Package, Wrench, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportWorkOrdersToPDF } from "@/lib/pdf-export";
import { RoleExplanationCard } from "@/components/RoleExplanationCard";
import { cn } from "@/lib/utils";
import { HeaderCard, KpiGrid, KpiTile } from "@/components/design-system";

export default function WorkOrdersIndex() {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState("month");
  // Le filtre est amorçable par l'URL (`?status=pending`) pour qu'une tuile KPI
  // d'un autre tableau de bord arrive sur la liste déjà filtrée, au lieu de
  // lâcher l'utilisateur sur la liste complète à refaire le tri à la main.
  const STATUTS_VALIDES = ["pending", "in_progress", "awaiting_parts", "completed", "cancelled"];
  const statutInitial = (() => {
    if (typeof window === "undefined") return null;
    const demande = new URLSearchParams(window.location.search).get("status");
    return demande && STATUTS_VALIDES.includes(demande) ? demande : null;
  })();
  const [activeStatusFilter, setActiveStatusFilter] = useState<string | null>(statutInitial);
  const { toast } = useToast();

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/work-orders/statistics", { period }],
    staleTime: 0,
    refetchInterval: 7000,
    refetchIntervalInBackground: true,
  });

  const { data: allWorkOrders } = useQuery<any>({
    queryKey: ["/api/work-orders", { limit: 300, offset: 0 }],
    staleTime: 0,
    refetchInterval: 7000,
    refetchIntervalInBackground: true,
  });

  const handleAddWorkOrder = () => {
    setLocation("/maintenance/work-orders/new");
  };

  const handleExport = async () => {
    try {
      const workOrdersData = allWorkOrders?.workOrders || [];
      await exportWorkOrdersToPDF(workOrdersData);
      toast({ title: "Export réussi", description: "Le rapport des ordres de travail a été téléchargé." });
    } catch {
      toast({ title: "Erreur d'export", description: "Une erreur est survenue lors de l'export.", variant: "destructive" });
    }
  };

  const totalCount =
    (stats?.pending || 0) + (stats?.inProgress || 0) +
    (stats?.awaitingParts || 0) + (stats?.completed || 0) + (stats?.cancelled || 0);

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Maintenance · CMMS"
        title="Ordres de travail"
        subtitle="Suivi des interventions et réparations"
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-8 text-xs border-gray-200 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Cette semaine</SelectItem>
                <SelectItem value="month">Ce mois</SelectItem>
                <SelectItem value="quarter">Ce trimestre</SelectItem>
                <SelectItem value="year">Cette année</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-2 h-8 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export PDF
            </Button>
            <Button size="sm" onClick={handleAddWorkOrder} className="gap-2 h-8 text-xs" data-help-target="wo-new">
              <Plus className="h-3.5 w-3.5" />
              Nouvel OT
            </Button>
          </div>
        }
      >
        <KpiGrid columns={6}>
          <KpiTile
            label="Tous"
            value={totalCount}
            subValue="Total période"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-500"
            className={cn("cursor-pointer", activeStatusFilter === null && "ring-2 ring-gray-300")}
            onClick={() => setActiveStatusFilter(null)}
            data-testid="filter-all"
          />
          <KpiTile
            label="En attente"
            value={stats?.pending || 0}
            subValue="À démarrer"
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName={activeStatusFilter === "pending" ? "bg-yellow-100 text-yellow-600" : "bg-yellow-50 text-yellow-500"}
            valueClassName="text-yellow-600"
            className={cn("cursor-pointer", activeStatusFilter === "pending" && "ring-2 ring-yellow-400")}
            onClick={() => setActiveStatusFilter(activeStatusFilter === "pending" ? null : "pending")}
            data-testid="filter-pending"
          />
          <KpiTile
            label="En cours"
            value={stats?.inProgress || 0}
            subValue="Actifs"
            icon={<PlayCircle className="h-4 w-4" />}
            iconWrapperClassName={activeStatusFilter === "in_progress" ? "bg-blue-100 text-blue-600" : "bg-blue-50 text-blue-500"}
            valueClassName="text-blue-600"
            className={cn("cursor-pointer", activeStatusFilter === "in_progress" && "ring-2 ring-blue-400")}
            onClick={() => setActiveStatusFilter(activeStatusFilter === "in_progress" ? null : "in_progress")}
            data-testid="filter-in-progress"
          />
          <KpiTile
            label="Attente pièces"
            value={stats?.awaitingParts || 0}
            subValue="Bloqués"
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName={activeStatusFilter === "awaiting_parts" ? "bg-amber-100 text-amber-600" : "bg-amber-50 text-amber-500"}
            valueClassName="text-amber-600"
            className={cn("cursor-pointer", activeStatusFilter === "awaiting_parts" && "ring-2 ring-amber-400")}
            onClick={() => setActiveStatusFilter(activeStatusFilter === "awaiting_parts" ? null : "awaiting_parts")}
            data-testid="filter-awaiting-parts"
          />
          <KpiTile
            label="Terminés"
            value={stats?.completed || 0}
            subValue="Clôturés"
            icon={<CheckCircle className="h-4 w-4" />}
            iconWrapperClassName={activeStatusFilter === "completed" ? "bg-green-100 text-green-600" : "bg-green-50 text-green-500"}
            valueClassName="text-green-600"
            className={cn("cursor-pointer", activeStatusFilter === "completed" && "ring-2 ring-green-400")}
            onClick={() => setActiveStatusFilter(activeStatusFilter === "completed" ? null : "completed")}
            data-testid="filter-completed"
          />
          <KpiTile
            label="Annulés"
            value={stats?.cancelled || 0}
            subValue="Clôturés"
            icon={<XCircle className="h-4 w-4" />}
            iconWrapperClassName={activeStatusFilter === "cancelled" ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-400"}
            className={cn("cursor-pointer", activeStatusFilter === "cancelled" && "ring-2 ring-gray-400")}
            onClick={() => setActiveStatusFilter(activeStatusFilter === "cancelled" ? null : "cancelled")}
            data-testid="filter-cancelled"
          />
        </KpiGrid>
      </HeaderCard>

      <RoleExplanationCard pageType="work-orders" />

      {activeStatusFilter && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Filtré par :</span>
          <button
            onClick={() => setActiveStatusFilter(null)}
            data-testid="clear-filter"
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {activeStatusFilter === "pending" && "En attente"}
            {activeStatusFilter === "in_progress" && "En cours"}
            {activeStatusFilter === "awaiting_parts" && "Attente pièces"}
            {activeStatusFilter === "completed" && "Terminés"}
            {activeStatusFilter === "cancelled" && "Annulés"}
            <XCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden" data-help-target="wo-table">
        <WorkOrderTable initialStatusFilter={activeStatusFilter} />
      </div>
    </div>
  );
}
