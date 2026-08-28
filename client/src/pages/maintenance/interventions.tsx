import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Package,
  PlayCircle,
  Plus,
  Search,
  Settings2,
  UserRound,
  Wrench,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CardShell,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  PremiumTabsNav,
  SectionLabel,
  StatusBadge,
  UrgencyBadge,
  getUrgencyBorderClass,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";

interface WorkOrderRow {
  id: number;
  title?: string;
  description?: string;
  vehicleRegistration?: string;
  vehicleRegistrationNumber?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  priority?: string;
  status?: string;
  technicianId?: number | null;
  technicianName?: string | null;
  createdAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

const statusOrder = ["all", "pending", "in_progress", "awaiting_parts", "completed", "cancelled"] as const;
type StatusTab = (typeof statusOrder)[number];
type KnownStatus = Exclude<StatusTab, "all">;
type PriorityLevel = "critical" | "high" | "medium" | "low";

const STATUS_META: Record<KnownStatus, { label: string; icon: LucideIcon }> = {
  pending: { label: "En attente", icon: Clock },
  in_progress: { label: "En cours", icon: PlayCircle },
  awaiting_parts: { label: "Attente pieces", icon: Package },
  completed: { label: "Terminees", icon: CheckCircle2 },
  cancelled: { label: "Annulees", icon: XCircle },
};

const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  critical: "Critique",
  high: "Haute",
  medium: "Moyenne",
  low: "Faible",
};

const normalizeToken = (value: string | null | undefined) =>
  (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");

const normalizeStatus = (value: string | null | undefined): KnownStatus | "unknown" => {
  const token = normalizeToken(value);

  const statusAliases: Record<string, KnownStatus> = {
    pending: "pending",
    en_attente: "pending",
    waiting: "pending",

    in_progress: "in_progress",
    inprogress: "in_progress",
    en_cours: "in_progress",
    active: "in_progress",

    awaiting_parts: "awaiting_parts",
    awaitingpart: "awaiting_parts",
    waiting_parts: "awaiting_parts",
    attente_pieces: "awaiting_parts",

    completed: "completed",
    done: "completed",
    terminee: "completed",
    termine: "completed",

    cancelled: "cancelled",
    canceled: "cancelled",
    annulee: "cancelled",
    annule: "cancelled",
  };

  return statusAliases[token] || "unknown";
};

const normalizePriority = (value: string | null | undefined): PriorityLevel => {
  const token = normalizeToken(value);

  const priorityAliases: Record<string, PriorityLevel> = {
    critical: "critical",
    critique: "critical",

    high: "high",
    haute: "high",
    elevee: "high",
    eleve: "high",

    medium: "medium",
    moyenne: "medium",
    normal: "medium",

    low: "low",
    faible: "low",
    basse: "low",
  };

  return priorityAliases[token] || "medium";
};

const formatDateCell = (dateValue?: string | null): string => {
  if (!dateValue) return "-";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  return format(parsed, "dd/MM/yyyy", { locale: fr });
};

const toTimestamp = (row: WorkOrderRow): number => {
  const dateValue = row.endDate || row.startDate || row.createdAt;
  if (!dateValue) return 0;
  const ts = new Date(dateValue).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

export default function InterventionsPage() {
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [technicianFilter, setTechnicianFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<StatusTab>("all");

  const {
    data: workOrdersData,
    isLoading,
    isError,
  } = useQuery<any>({
    queryKey: ["/api/work-orders", { limit: 1000, offset: 0 }],
  });

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/users"],
  });

  const allWorkOrders: WorkOrderRow[] = useMemo(() => {
    if (Array.isArray(workOrdersData)) return workOrdersData;
    if (Array.isArray(workOrdersData?.workOrders)) return workOrdersData.workOrders;
    return [];
  }, [workOrdersData]);

  const allUsers = useMemo(() => {
    if (Array.isArray(usersData)) return usersData;
    if (Array.isArray(usersData?.users)) return usersData.users;
    return [];
  }, [usersData]);

  const technicians = useMemo(
    () => allUsers.filter((user: any) => user.role === "technician" || user.role === "workshop_manager"),
    [allUsers],
  );

  const countsByStatus = useMemo(() => {
    const base: Record<KnownStatus, number> = {
      pending: 0,
      in_progress: 0,
      awaiting_parts: 0,
      completed: 0,
      cancelled: 0,
    };

    allWorkOrders.forEach((order) => {
      const normalized = normalizeStatus(order.status);
      if (normalized !== "unknown") base[normalized] += 1;
    });

    return base;
  }, [allWorkOrders]);

  const assignedCount = useMemo(
    () =>
      allWorkOrders.filter(
        (order) =>
          Boolean(order.technicianName && order.technicianName.trim()) ||
          Boolean(order.technicianId),
      ).length,
    [allWorkOrders],
  );

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    priorityFilter !== "all" ||
    technicianFilter !== "all";

  const filteredByInputs = useMemo(() => {
    return allWorkOrders.filter((order) => {
      const searchableText = [
        `OT #${order.id}`,
        order.title,
        order.description,
        order.vehicleRegistration,
        order.vehicleRegistrationNumber,
        order.technicianName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        searchTerm.trim().length === 0 ||
        searchableText.includes(searchTerm.trim().toLowerCase());

      const matchesPriority =
        priorityFilter === "all" ||
        normalizePriority(order.priority) === priorityFilter;

      const matchesTechnician =
        technicianFilter === "all" || String(order.technicianId || "") === technicianFilter;

      return matchesSearch && matchesPriority && matchesTechnician;
    });
  }, [allWorkOrders, searchTerm, priorityFilter, technicianFilter]);

  const rowsByTab = useMemo(() => {
    const sorted = [...filteredByInputs].sort((a, b) => toTimestamp(b) - toTimestamp(a));

    const grouped: Record<StatusTab, WorkOrderRow[]> = {
      all: sorted,
      pending: [],
      in_progress: [],
      awaiting_parts: [],
      completed: [],
      cancelled: [],
    };

    sorted.forEach((row) => {
      const normalized = normalizeStatus(row.status);
      if (normalized !== "unknown") {
        grouped[normalized].push(row);
      }
    });

    return grouped;
  }, [filteredByInputs]);

  const tabItems = useMemo(
    () =>
      statusOrder.map((status) => {
        if (status === "all") {
          return {
            value: status,
            icon: <TabIcon icon={Wrench} />,
            label: `Toutes (${rowsByTab.all.length})`,
          };
        }

        const Icon = STATUS_META[status].icon;
        return {
          value: status,
          icon: <TabIcon icon={Icon} />,
          label: `${STATUS_META[status].label} (${rowsByTab[status].length})`,
        };
      }),
    [rowsByTab],
  );

  const columns: PremiumDataTableColumn<WorkOrderRow>[] = [
    {
      id: "ot",
      header: "Intervention",
      widthClassName: "w-[280px]",
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">#{row.id} · {row.title || "Intervention corrective"}</p>
          <p className="text-xs text-gray-400 line-clamp-1">{row.description || "Aucune description detaillee"}</p>
        </div>
      ),
    },
    {
      id: "vehicle",
      header: "Vehicule",
      cell: (row) => (
        <div>
          <p className="text-sm font-medium text-gray-700">
            {row.vehicleRegistration || row.vehicleRegistrationNumber || "N/A"}
          </p>
          {(row.vehicleBrand || row.vehicleModel) ? (
            <p className="text-xs text-gray-400">{row.vehicleBrand || ""} {row.vehicleModel || ""}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: "technician",
      header: "Technicien",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
          <UserRound className="h-3.5 w-3.5 text-gray-400" />
          {row.technicianName || "Non assigne"}
        </span>
      ),
    },
    {
      id: "priority",
      header: "Priorite",
      widthClassName: "w-[130px]",
      cell: (row) => {
        const priority = normalizePriority(row.priority);
        return <UrgencyBadge urgency={priority} label={PRIORITY_LABEL[priority]} />;
      },
    },
    {
      id: "status",
      header: "Statut",
      widthClassName: "w-[150px]",
      cell: (row) => {
        const status = normalizeStatus(row.status);

        if (status === "unknown") {
          return (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
              Inconnu
            </span>
          );
        }

        if (status === "awaiting_parts") {
          return <StatusBadge status="partial" label="Attente pieces" />;
        }

        if (status === "in_progress") {
          return <StatusBadge status="confirmed" label="En cours" />;
        }

        return <StatusBadge status={status} label={STATUS_META[status].label} />;
      },
    },
    {
      id: "date",
      header: "Date",
      widthClassName: "w-[120px]",
      cell: (row) => (
        <span className="text-sm text-gray-500">{formatDateCell(row.endDate || row.startDate || row.createdAt)}</span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[120px]",
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/maintenance/work-orders/${row.id}`);
          }}
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          Ouvrir
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-72" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-8 w-40" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 border-t border-gray-100 pt-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={`interventions-kpi-skeleton-${index}`} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </CardShell>

        <CardShell>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </CardShell>

        <CardShell>
          <div className="p-5 space-y-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Maintenance · Correctif"
        title="Interventions"
        subtitle="Pilotage des interventions atelier en cours et a traiter"
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => navigate("/maintenance/work-orders")}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Vue OT complete
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => navigate("/maintenance/work-orders/new")}
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle intervention
            </Button>
          </div>
        }
      >
        <KpiGrid columns={6}>
          <KpiTile
            label="Toutes"
            value={allWorkOrders.length}
            subValue={`${assignedCount} assignees`}
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-600"
            className={cn("cursor-pointer", activeTab === "all" && "ring-2 ring-gray-300")}
            onClick={() => setActiveTab("all")}
          />
          <KpiTile
            label="En attente"
            value={countsByStatus.pending}
            subValue="A demarrer"
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-yellow-50 text-yellow-600"
            valueClassName={countsByStatus.pending > 0 ? "text-yellow-700" : undefined}
            className={cn("cursor-pointer", activeTab === "pending" && "ring-2 ring-yellow-300")}
            onClick={() => setActiveTab("pending")}
          />
          <KpiTile
            label="En cours"
            value={countsByStatus.in_progress}
            subValue="Interventions actives"
            icon={<PlayCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
            valueClassName={countsByStatus.in_progress > 0 ? "text-blue-700" : undefined}
            className={cn("cursor-pointer", activeTab === "in_progress" && "ring-2 ring-blue-300")}
            onClick={() => setActiveTab("in_progress")}
          />
          <KpiTile
            label="Attente pieces"
            value={countsByStatus.awaiting_parts}
            subValue="Bloquees"
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
            valueClassName={countsByStatus.awaiting_parts > 0 ? "text-orange-700" : undefined}
            className={cn("cursor-pointer", activeTab === "awaiting_parts" && "ring-2 ring-orange-300")}
            onClick={() => setActiveTab("awaiting_parts")}
          />
          <KpiTile
            label="Terminees"
            value={countsByStatus.completed}
            subValue="Cloturees"
            icon={<CheckCircle2 className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName={countsByStatus.completed > 0 ? "text-green-700" : undefined}
            className={cn("cursor-pointer", activeTab === "completed" && "ring-2 ring-green-300")}
            onClick={() => setActiveTab("completed")}
          />
          <KpiTile
            label="Annulees"
            value={countsByStatus.cancelled}
            subValue="Hors flux"
            icon={<XCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
            valueClassName={countsByStatus.cancelled > 0 ? "text-red-700" : undefined}
            className={cn("cursor-pointer", activeTab === "cancelled" && "ring-2 ring-red-300")}
            onClick={() => setActiveTab("cancelled")}
          />
        </KpiGrid>
      </HeaderCard>

      <CardShell>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <SectionLabel>Filtres</SectionLabel>
            {hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setSearchTerm("");
                  setPriorityFilter("all");
                  setTechnicianFilter("all");
                }}
              >
                Reinitialiser
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Rechercher (OT, description, vehicule, technicien)"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-9 h-9 text-sm border-gray-200 bg-gray-50"
              />
            </div>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-9 text-sm border-gray-200 bg-gray-50">
                <SelectValue placeholder="Toutes les priorites" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les priorites</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="low">Faible</SelectItem>
              </SelectContent>
            </Select>

            <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
              <SelectTrigger className="h-9 text-sm border-gray-200 bg-gray-50">
                <SelectValue placeholder="Tous les techniciens" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les techniciens</SelectItem>
                {technicians.map((tech: any) => (
                  <SelectItem key={tech.id} value={String(tech.id)}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardShell>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as StatusTab)}>
        <PremiumTabsNav tabs={tabItems} />

        {statusOrder.map((status) => (
          <TabsContent key={status} value={status} className="mt-0">
            <PremiumDataTable
              columns={columns}
              rows={rowsByTab[status]}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/maintenance/work-orders/${row.id}`)}
              rowClassName={(row, rowIndex) => {
                const priority = normalizePriority(row.priority);
                return cn(
                  "border-l-2",
                  getUrgencyBorderClass(priority),
                  rowIndex % 2 === 0 ? "bg-white" : "bg-gray-50/35",
                );
              }}
              toolbar={
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-gray-500">
                    {rowsByTab[status].length} intervention{rowsByTab[status].length > 1 ? "s" : ""}
                  </div>
                  {isError ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Donnees inaccessibles
                    </span>
                  ) : null}
                </div>
              }
              emptyState="Aucune intervention pour ces filtres."
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
