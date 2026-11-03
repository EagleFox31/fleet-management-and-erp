import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Edit,
  Filter,
  Package,
  Search,
  Trash2,
  CircleDot,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PremiumDataTable,
  type PremiumDataTableColumn,
  type SortDirection,
} from "@/components/design-system";
import { useAuth } from "@/hooks/useAuth";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { userMessageOf } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPrice } from "@/lib/utils";
import { formatTireUsageLabel, mapTireUsageToDb } from "@shared/constants/tires";
import { TIRE_STOCK_SOURCES, TIRE_STOCK_SOURCE_LABELS, usedTiresLabel, type TireStockSource } from "@shared/constants/tire-stock";
import { useMutation } from "@tanstack/react-query";

export interface TireTableRow {
  id: number;
  brand: string;
  model: string;
  size: string;
  tireType: string;
  stockQuantity: number;
  /** Pneus démontés remis en stock (ont roulé) : non valorisés, hors seuil de stock bas. */
  usedStockQuantity?: number;
  minStockLevel: number;
  purchasePrice: number;
  supplier: string;
  location: string;
}

interface TireTableProps {
  tires: TireTableRow[];
  isLoading?: boolean;
  onRowClick: (tire: TireTableRow) => void;
  onEdit: (tire: TireTableRow) => void;
  onMountFromStock?: (tire: TireTableRow) => void;
}

const ITEMS_PER_PAGE = 10;

function compareTireRows(a: TireTableRow, b: TireTableRow, column: string, direction: SortDirection) {
  const factor = direction === "asc" ? 1 : -1;
  const read = (row: TireTableRow): string | number => {
    switch (column) {
      case "size":
        return row.size;
      case "brand":
        return `${row.brand} ${row.model}`.toLowerCase();
      case "stockQuantity":
        return row.stockQuantity;
      case "purchasePrice":
        return Number(row.purchasePrice) || 0;
      case "location":
        return row.location?.toLowerCase() ?? "";
      case "supplier":
        return row.supplier?.toLowerCase() ?? "";
      case "tireType":
        return formatTireUsageLabel(row.tireType).toLowerCase();
      default:
        return row.brand.toLowerCase();
    }
  };
  const left = read(a);
  const right = read(b);
  if (left < right) return -1 * factor;
  if (left > right) return 1 * factor;
  return 0;
}

export function TireTable({ tires, isLoading = false, onRowClick, onEdit, onMountFromStock }: TireTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState("brand");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [stockDialogTire, setStockDialogTire] = useState<TireTableRow | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState(0);
  const [stockKind, setStockKind] = useState<TireStockSource>("new");

  const canEditTires = user?.role === "admin" || user?.role === "warehouse";
  const canDeleteTires = user?.role === "admin";

  const handleSortChange = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const filteredTires = useMemo(() => {
    return tires.filter((tire) => {
      const matchesSearch =
        tire.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tire.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tire.size.toLowerCase().includes(searchTerm.toLowerCase());

      if (filterType === "all") return matchesSearch;
      if (filterType === "low_stock") {
        return matchesSearch && tire.stockQuantity <= tire.minStockLevel;
      }
      if (filterType === "direction" || filterType === "moteur" || filterType === "remorque") {
        return matchesSearch && tire.tireType === mapTireUsageToDb(filterType);
      }
      return matchesSearch;
    });
  }, [tires, searchTerm, filterType]);

  const sortedTires = useMemo(
    () => [...filteredTires].sort((a, b) => compareTireRows(a, b, sortColumn, sortDirection)),
    [filteredTires, sortColumn, sortDirection],
  );

  const totalTires = sortedTires.length;
  const totalPages = Math.max(1, Math.ceil(totalTires / ITEMS_PER_PAGE));
  const pagedTires = sortedTires.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const adjustStockMutation = useMutation({
    mutationFn: ({ id, kind, quantity }: { id: number; kind: TireStockSource; quantity: number }) =>
      apiRequest("PATCH", `/api/tires/${id}`, kind === "used" ? { usedStockQuantity: quantity } : { stockQuantity: quantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/low-stock"] });
      toast({
        title: "Stock mis à jour",
        description: "La quantité en stock a été enregistrée.",
      });
      setStockDialogTire(null);
      setStockAdjustment(0);
      setStockKind("new");
    },
    onError: (error: Error) => {
      toast({
        title: "Ajustement impossible",
        description: userMessageOf(error, "Le stock n'a pas été modifié."),
        variant: "destructive",
      });
    },
  });
  const submitStockAdjustment = useSingleFlightMutate(adjustStockMutation.mutate);
  const dialogCurrentStock = stockDialogTire
    ? stockKind === "used"
      ? stockDialogTire.usedStockQuantity ?? 0
      : stockDialogTire.stockQuantity
    : 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tires/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/low-stock"] });
      toast({
        title: "Pneu supprimé",
        description: "Le pneu a été retiré de l'inventaire.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur de suppression",
        description: userMessageOf(error, "Impossible de supprimer ce pneu."),
        variant: "destructive",
      });
    },
  });

  const columns: PremiumDataTableColumn<TireTableRow>[] = [
    {
      id: "size",
      header: "Dimension",
      sortable: true,
      widthClassName: "whitespace-nowrap",
      cell: (tire) => (
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-gray-600 whitespace-nowrap">
          {tire.size}
        </span>
      ),
    },
    {
      id: "brand",
      header: "Pneu",
      sortable: true,
      widthClassName: "max-w-[200px]",
      cell: (tire) => (
        <div>
          <p className="font-medium text-gray-800 leading-tight truncate">
            {tire.brand} {tire.model}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">
            {formatTireUsageLabel(tire.tireType)}
          </p>
        </div>
      ),
    },
    {
      id: "stockQuantity",
      header: "Stock",
      sortable: true,
      cell: (tire) => {
        const isLowStock = tire.stockQuantity <= tire.minStockLevel;
        return (
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-bold tabular-nums ${
                isLowStock ? "text-red-500" : "text-gray-800"
              }`}
            >
              {tire.stockQuantity}
              <span className="text-[11px] font-normal text-gray-400 ml-1">pcs</span>
            </span>
            {(tire.usedStockQuantity ?? 0) > 0 && (
              <span
                className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap"
                data-testid={`tire-used-stock-${tire.id}`}
              >
                + {usedTiresLabel(tire.usedStockQuantity ?? 0)}
              </span>
            )}
            {isLowStock && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 whitespace-nowrap">
                <AlertCircle className="h-2.5 w-2.5" />
                min {tire.minStockLevel}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "purchasePrice",
      header: "Prix unitaire",
      sortable: true,
      cell: (tire) => (
        <span className="text-sm font-semibold text-gray-800 tabular-nums">
          {formatPrice(Number(tire.purchasePrice) || 0)}
        </span>
      ),
    },
    {
      id: "location",
      header: "Emplacement",
      sortable: true,
      cell: (tire) =>
        tire.location ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 whitespace-nowrap">
            {tire.location}
          </span>
        ) : (
          <span className="text-gray-300 text-xs select-none">—</span>
        ),
    },
    {
      id: "supplier",
      header: "Fournisseur",
      sortable: true,
      cell: (tire) =>
        tire.supplier ? (
          <span className="text-sm text-gray-600 truncate max-w-[140px] block">{tire.supplier}</span>
        ) : (
          <span className="text-gray-300 text-xs select-none">—</span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      cell: (tire) => (
        <TooltipProvider>
          <div className="flex items-center justify-end gap-0.5">
            {onMountFromStock && tire.stockQuantity + (tire.usedStockQuantity ?? 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMountFromStock(tire);
                    }}
                    aria-label={`Monter ${tire.brand} ${tire.model} sur un véhicule`}
                    data-testid={`btn-mount-tire-${tire.id}`}
                  >
                    <CircleDot className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Monter sur un véhicule</TooltipContent>
              </Tooltip>
            )}
            {canEditTires && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStockDialogTire(tire);
                        setStockAdjustment(0);
                        setStockKind("new");
                      }}
                      aria-label={`Ajuster le stock de ${tire.brand} ${tire.model}`}
                      data-testid={`btn-adjust-tire-stock-${tire.id}`}
                    >
                      <Package className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Ajuster le stock</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-green-50 text-green-500 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(tire);
                      }}
                      aria-label={`Modifier ${tire.brand} ${tire.model}`}
                      data-testid={`button-edit-tire-${tire.id}`}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Modifier la fiche</TooltipContent>
                </Tooltip>
              </>
            )}
            {canDeleteTires && (
              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Supprimer ${tire.brand} ${tire.model}`}
                        data-testid={`button-delete-tire-${tire.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Supprimer le pneu</TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
                    <AlertDialogDescription>
                      Supprimer {tire.brand} {tire.model} ({tire.size}) ? Cette action est
                      irréversible.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate(tire.id)}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </TooltipProvider>
      ),
    },
  ];

  return (
    <>
      <Dialog
        open={stockDialogTire !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStockDialogTire(null);
            setStockAdjustment(0);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajuster le stock</DialogTitle>
            <DialogDescription>
              {stockDialogTire
                ? `${stockDialogTire.brand} ${stockDialogTire.model} — ${stockDialogTire.size}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {stockDialogTire && (
            <div className="space-y-4 py-2">
              <div className="flex gap-2" role="radiogroup" aria-label="Stock à ajuster">
                {TIRE_STOCK_SOURCES.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={stockKind === kind}
                    variant={stockKind === kind ? "default" : "outline"}
                    onClick={() => {
                      setStockKind(kind);
                      setStockAdjustment(0);
                    }}
                    data-testid={`button-tire-stock-kind-${kind}`}
                  >
                    {TIRE_STOCK_SOURCE_LABELS[kind]}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div
                  className="rounded-xl p-3"
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}
                >
                  <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">
                    Stock actuel
                  </p>
                  <p className="text-sm font-semibold text-gray-800">
                    {dialogCurrentStock} unité(s)
                  </p>
                </div>
                <div
                  className="rounded-xl p-3"
                  style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
                >
                  <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-0.5">
                    Après ajustement
                  </p>
                  <p className="font-bold text-[15px] text-green-700">
                    {Math.max(0, dialogCurrentStock + stockAdjustment)} unité(s)
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="tire-stock-adjustment"
                  className="text-[10px] font-bold tracking-widest uppercase text-gray-400"
                >
                  Ajustement
                </label>
                <input
                  id="tire-stock-adjustment"
                  type="number"
                  value={stockAdjustment}
                  onChange={(e) => setStockAdjustment(parseInt(e.target.value, 10) || 0)}
                  placeholder="+ pour ajouter, - pour retirer"
                  data-testid="input-tire-stock-adjustment"
                  className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStockDialogTire(null)}>
                  Annuler
                </Button>
                <Button
                  disabled={stockAdjustment === 0 || adjustStockMutation.isPending}
                  onClick={() =>
                    submitStockAdjustment({
                      id: stockDialogTire.id,
                      kind: stockKind,
                      quantity: Math.max(0, dialogCurrentStock + stockAdjustment),
                    })
                  }
                  data-testid="button-confirm-tire-stock-adjustment"
                >
                  {adjustStockMutation.isPending ? "Enregistrement…" : "Confirmer"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PremiumDataTable
        columns={columns}
        rows={isLoading ? [] : pagedTires}
        rowKey={(tire) => tire.id}
        excelHeader
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onRowClick={(tire) => onRowClick(tire)}
        toolbarClassName="px-4 py-2.5"
        footerClassName="px-4 py-2"
        rowClassName={(tire) => {
          const isLowStock = tire.stockQuantity <= tire.minStockLevel;
          return isLowStock
            ? "border-l-2 border-l-red-400 bg-red-50/30 hover:bg-red-50/60"
            : "border-l-2 border-l-transparent";
        }}
        tableContainerClassName="max-h-[520px]"
        emptyState={
          isLoading ? (
            "Chargement des pneus…"
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400 py-4">
              <Package className="h-9 w-9 opacity-30" />
              <p className="text-sm font-medium">Aucun pneu trouvé</p>
              <p className="text-xs">Modifiez la recherche ou le filtre</p>
            </div>
          )
        }
        toolbar={
          <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
                placeholder="Rechercher par marque, modèle ou dimension…"
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <Select
              value={filterType}
              onValueChange={(value) => {
                setFilterType(value);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-56 bg-gray-50 border-gray-100">
                <Filter className="h-4 w-4 mr-2 text-gray-500" />
                <SelectValue placeholder="Filtrer…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les pneus</SelectItem>
                <SelectItem value="low_stock">Stock faible</SelectItem>
                <SelectItem value="direction">Direction</SelectItem>
                <SelectItem value="moteur">Moteur</SelectItem>
                <SelectItem value="remorque">Remorque</SelectItem>
              </SelectContent>
            </Select>
            {totalTires > 0 && (
              <span className="text-xs text-gray-400 sm:ml-auto">
                {totalTires} pneu{totalTires > 1 ? "s" : ""}
              </span>
            )}
          </div>
        }
        footer={
          totalPages > 0 ? (
            <div className="w-full flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {totalTires > 0 ? (
                  <>
                    Affichage {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                    {Math.min(currentPage * ITEMS_PER_PAGE, totalTires)} sur {totalTires}
                  </>
                ) : (
                  "Aucun élément"
                )}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  <span className="px-3 py-1 text-xs text-gray-500 font-medium">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                </div>
              )}
            </div>
          ) : undefined
        }
      />
    </>
  );
}
