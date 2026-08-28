import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  Package,
  Search,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardShell,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  SectionLabel,
  StatusBadge,
  type PremiumDataTableColumn,
} from "@/components/design-system";

interface StockMovement {
  id: number;
  partId: number;
  partName?: string;
  partReference?: string;
  movementType: "in" | "out" | "adjustment" | "initial";
  quantity: number;
  reason?: string;
  workOrderId?: number;
  workOrderTitle?: string;
  performedBy?: number;
  performedByName?: string;
  createdAt: string;
  date?: string;
}

const formatMovementDate = (movement: StockMovement) => {
  const rawDate = movement.createdAt || movement.date || "";
  if (!rawDate) return "-";

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return "-";

  return parsedDate.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const movementTypeLabel = (type: StockMovement["movementType"]) => {
  switch (type) {
    case "in":
      return "Entree";
    case "out":
      return "Sortie";
    case "adjustment":
      return "Ajustement";
    case "initial":
      return "Initial";
    default:
      return type;
  }
};

const movementTypeStatus = (type: StockMovement["movementType"]) => {
  if (type === "in") return { status: "received", label: "Entree" };
  if (type === "out") return { status: "cancelled", label: "Sortie" };
  if (type === "adjustment") return { status: "partial", label: "Ajustement" };
  return { status: "draft", label: "Initial" };
};

const getMovementTimestamp = (movement: StockMovement) => {
  const rawDate = movement.createdAt || movement.date || "";
  const ts = new Date(rawDate).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

export default function InventoryMovementsPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");

  const { data: movements = [], isLoading } = useQuery<StockMovement[]>({
    queryKey: ["/api/parts/stock-movements"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const filteredMovements = useMemo(() => {
    return movements
      .filter((movement) => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        const searchableValues = [
          movement.partName || "",
          movement.partReference || "",
          movement.reason || "",
          movement.workOrderTitle || "",
        ];

        const matchesSearch =
          normalizedSearch.length === 0 ||
          searchableValues.some((value) => value.toLowerCase().includes(normalizedSearch));

        const matchesType = typeFilter === "all" || movement.movementType === typeFilter;

        let matchesPeriod = true;
        if (periodFilter !== "all") {
          const movementDate = new Date(movement.createdAt || movement.date || 0);
          if (Number.isNaN(movementDate.getTime())) {
            return false;
          }

          const now = new Date();

          if (periodFilter === "today") {
            matchesPeriod = movementDate.toDateString() === now.toDateString();
          } else if (periodFilter === "week") {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            matchesPeriod = movementDate >= weekAgo;
          } else if (periodFilter === "month") {
            matchesPeriod =
              movementDate.getMonth() === now.getMonth() &&
              movementDate.getFullYear() === now.getFullYear();
          }
        }

        return matchesSearch && matchesType && matchesPeriod;
      })
      .sort((a, b) => getMovementTimestamp(b) - getMovementTimestamp(a));
  }, [movements, searchTerm, typeFilter, periodFilter]);

  const stats = useMemo(() => {
    const entries = filteredMovements.filter((m) => m.movementType === "in");
    const outputs = filteredMovements.filter((m) => m.movementType === "out");

    return {
      entriesCount: entries.length,
      outputsCount: outputs.length,
      quantityIn: entries.reduce((sum, m) => sum + m.quantity, 0),
      quantityOut: outputs.reduce((sum, m) => sum + m.quantity, 0),
    };
  }, [filteredMovements]);

  const columns: PremiumDataTableColumn<StockMovement>[] = [
    {
      id: "date",
      header: "Date",
      widthClassName: "w-[180px]",
      cell: (movement) => (
        <div className="inline-flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
          {formatMovementDate(movement)}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      widthClassName: "w-[140px]",
      cell: (movement) => {
        const badge = movementTypeStatus(movement.movementType);
        return <StatusBadge status={badge.status} label={badge.label} />;
      },
    },
    {
      id: "part",
      header: "Piece",
      cell: (movement) => (
        <div className="min-w-0">
          <p className="font-medium text-gray-800 truncate">{movement.partName || "N/A"}</p>
          <p className="text-xs text-gray-400 truncate">{movement.partReference || "-"}</p>
        </div>
      ),
    },
    {
      id: "quantity",
      header: "Quantite",
      widthClassName: "w-[110px]",
      cell: (movement) => {
        const sign = movement.movementType === "in" ? "+" : movement.movementType === "out" ? "-" : "";
        const colorClass =
          movement.movementType === "in"
            ? "text-green-600"
            : movement.movementType === "out"
              ? "text-red-600"
              : "text-blue-600";

        return <span className={`text-sm font-bold ${colorClass}`}>{sign}{movement.quantity}</span>;
      },
    },
    {
      id: "reason",
      header: "Motif / OT",
      cell: (movement) => {
        if (movement.workOrderId) {
          return (
            <Button
              variant="link"
              className="h-auto p-0 text-blue-600 text-sm"
              onClick={(event) => {
                event.stopPropagation();
                setLocation(`/maintenance/work-orders/${movement.workOrderId}`);
              }}
            >
              <Wrench className="h-3.5 w-3.5 mr-1" />
              OT #{movement.workOrderId}
            </Button>
          );
        }

        return <span className="text-sm text-gray-500">{movement.reason || "-"}</span>;
      },
    },
    {
      id: "author",
      header: "Par",
      widthClassName: "w-[170px]",
      cell: (movement) => (
        <span className="text-sm text-gray-600">{movement.performedByName || "Systeme"}</span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5 space-y-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-80" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 border-t border-gray-100 pt-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`movements-kpi-${index}`} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </CardShell>
        <CardShell>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={`movements-filter-${index}`} className="h-9 rounded-lg" />
            ))}
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Stock · Tracabilite"
        title="Mouvements de stock"
        subtitle="Historique detaille des entrees et sorties de pieces"
        icon={<Package className="h-5 w-5" />}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setLocation("/inventory")}
          >
            Retour a l'inventaire
          </Button>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Entrees"
            value={stats.entriesCount}
            subValue="Nb de mouvements"
            icon={<ArrowUpCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName={stats.entriesCount > 0 ? "text-green-700" : undefined}
          />
          <KpiTile
            label="Sorties"
            value={stats.outputsCount}
            subValue="Nb de mouvements"
            icon={<ArrowDownCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
            valueClassName={stats.outputsCount > 0 ? "text-red-700" : undefined}
          />
          <KpiTile
            label="Quantite entree"
            value={`+${stats.quantityIn}`}
            subValue="Unites sur la periode"
            icon={<ArrowUpCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
            valueClassName={stats.quantityIn > 0 ? "text-blue-700" : undefined}
          />
          <KpiTile
            label="Quantite sortie"
            value={`-${stats.quantityOut}`}
            subValue="Unites sur la periode"
            icon={<ArrowDownCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
            valueClassName={stats.quantityOut > 0 ? "text-orange-700" : undefined}
          />
        </KpiGrid>
      </HeaderCard>

      <CardShell>
        <div className="px-5 py-4">
          <SectionLabel className="mb-3 inline-block">Filtres</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Rechercher piece, reference, motif..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-9 pl-9 border-gray-200 bg-gray-50"
                data-testid="input-search-movements"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 border-gray-200 bg-gray-50" data-testid="select-type-filter">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="in">Entrees</SelectItem>
                <SelectItem value="out">Sorties</SelectItem>
                <SelectItem value="adjustment">Ajustements</SelectItem>
                <SelectItem value="initial">Initiaux</SelectItem>
              </SelectContent>
            </Select>

            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="h-9 border-gray-200 bg-gray-50" data-testid="select-period-filter">
                <SelectValue placeholder="Periode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tout</SelectItem>
                <SelectItem value="today">Aujourd'hui</SelectItem>
                <SelectItem value="week">Cette semaine</SelectItem>
                <SelectItem value="month">Ce mois</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardShell>

      <PremiumDataTable
        columns={columns}
        rows={filteredMovements}
        rowKey={(movement) => movement.id}
        rowClassName={(_, index) => (index % 2 === 0 ? "bg-white" : "bg-gray-50/35")}
        toolbar={
          <div className="text-sm text-gray-500">
            Historique des mouvements ({filteredMovements.length})
          </div>
        }
        emptyState="Aucun mouvement trouve pour cette periode."
      />
    </div>
  );
}
