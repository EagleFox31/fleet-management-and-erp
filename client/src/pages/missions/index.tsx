import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Package, MapPin, Truck, Calendar, Eye, AlertTriangle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { format } from "date-fns";
import { HeaderCard, KpiGrid, KpiTile } from "@/components/design-system";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  planned: "bg-blue-100 text-blue-700",
  assigned: "bg-purple-100 text-purple-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  delivered: "bg-green-100 text-green-700",
  completed: "bg-green-600 text-white",
  cancelled: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  planned: "Planifiée",
  assigned: "Assignée",
  in_progress: "En cours",
  delivered: "Livrée",
  completed: "Terminée",
  cancelled: "Annulée",
};

export default function MissionsPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: missions, isLoading } = useQuery<any>({
    queryKey: ["/api/missions"],
  });

  const filteredMissions = missions?.filter((mission: any) => {
    const matchesSearch =
      mission.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.pickupAddress?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.deliveryAddress?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || mission.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const now = new Date();
  const plannedMissions = missions?.filter((m: any) => ["planned", "assigned"].includes(m.status)) || [];
  const overduePlanned = plannedMissions.filter((m: any) => {
    const ref = m.pickupDate ?? m.deliveryDate;
    return ref && new Date(ref) < now;
  });

  const stats = {
    total: missions?.length || 0,
    planned: plannedMissions.length,
    inProgress: missions?.filter((m: any) => m.status === "in_progress").length || 0,
    completed: missions?.filter((m: any) => m.status === "completed").length || 0,
  };

  const filterButtons = [
    { value: "all", label: "Toutes" },
    { value: "planned", label: "Planifiées" },
    { value: "in_progress", label: "En cours" },
    { value: "completed", label: "Terminées" },
  ];

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Opérations · Transport"
        title="Gestion des Missions"
        subtitle="Planification et suivi des missions de transport"
        icon={<Truck className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setLocation("/missions/new")} className="gap-2 h-8 text-xs" data-testid="btn-new-mission">
            <Plus className="h-3.5 w-3.5" /> Nouvelle Mission
          </Button>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Total Missions"
            value={stats.total}
            subValue="Toutes périodes"
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-500"
          />
          <KpiTile
            label="Planifiées"
            value={stats.planned}
            subValue={
              overduePlanned.length > 0 ? (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5 text-red-500 shrink-0" />
                  <span className="text-red-500 font-semibold">{overduePlanned.length} en retard</span>
                </span>
              ) : "À démarrer"
            }
            icon={<Calendar className="h-4 w-4" />}
            iconWrapperClassName={overduePlanned.length > 0 ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}
            valueClassName={overduePlanned.length > 0 ? "text-red-600" : "text-blue-600"}
          />
          <KpiTile
            label="En cours"
            value={stats.inProgress}
            subValue="Actives"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-yellow-50 text-yellow-600"
            valueClassName="text-yellow-600"
          />
          <KpiTile
            label="Terminées"
            value={stats.completed}
            subValue="Clôturées"
            icon={<MapPin className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName="text-green-600"
          />
        </KpiGrid>
      </HeaderCard>

      {/* Table card */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex flex-col md:flex-row gap-3 items-start md:items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              placeholder="Rechercher par N° commande, adresse..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-missions"
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {filterButtons.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                data-testid={`filter-${value}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-missions">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">N° Commande</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Client</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Trajet</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Date Pickup</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Date Livraison</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Statut</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Véhicule</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Chauffeur</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {!filteredMissions?.length ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                          <Truck className="h-5 w-5 text-gray-300" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">
                          {searchTerm || statusFilter !== "all" ? "Aucune mission trouvée avec ces critères" : "Aucune mission créée"}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredMissions.map((mission: any) => (
                    <tr
                      key={mission.id}
                      className="group border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50/60 cursor-pointer border-l-2 border-l-transparent"
                      onClick={() => setLocation(`/missions/${mission.id}`)}
                      data-testid={`mission-row-${mission.id}`}
                    >
                      <td className="px-5 py-3.5 font-semibold text-gray-800">{mission.orderNumber}</td>
                      <td className="px-4 py-3.5 text-gray-600">{mission.client?.name || "—"}</td>
                      <td className="px-4 py-3.5">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-xs">
                            <span className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0">A</span>
                            <span className="truncate max-w-[160px] text-gray-700">{mission.pickupAddress}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            <span className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0">B</span>
                            <span className="truncate max-w-[160px] text-gray-500">{mission.deliveryAddress}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500">
                        {mission.pickupDate ? format(new Date(mission.pickupDate), "dd/MM/yyyy HH:mm") : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500">
                        {mission.deliveryDate ? format(new Date(mission.deliveryDate), "dd/MM/yyyy HH:mm") : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[mission.status] || "bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABELS[mission.status] || mission.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-600">
                        {mission.assignment?.vehicle?.registrationNumber || <span className="text-gray-300">Non assigné</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-600">
                        {mission.assignment?.driver
                          ? `${mission.assignment.driver.firstName} ${mission.assignment.driver.lastName}`
                          : <span className="text-gray-300">Non assigné</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex justify-end flex">
                          <button
                            onClick={(e) => { e.stopPropagation(); setLocation(`/missions/${mission.id}`); }}
                            data-testid={`btn-view-mission-${mission.id}`}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
