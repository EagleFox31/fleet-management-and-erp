import React, { useState, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { formatPrice } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { IDEMPOTENCY_HEADER, partStockKeyScope, sendWithSubmissionKey } from "@/lib/submission-key";
import { userMessageOf } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import {
  Edit, Trash2, Clock, Package, Truck, CheckCircle, ArrowRight, User, Wrench, FileText,
  Search, ChevronLeft, ChevronRight, AlertCircle, Info, Eye, ShoppingCart,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  PremiumDataTable,
  type PremiumDataTableColumn,
  type SortDirection,
} from "@/components/design-system";
import {
  getPartRequirementStatusConfig,
  getRequirementUrgencyBorderColor,
} from "@/lib/part-requirement-status";
import { PartRequirementStatusHelp } from "@/components/inventory/part-requirement-status-help";
import { XCircle } from "lucide-react";

interface Part {
  id: number;
  name: string;
  reference: string;
  description: string | null;
  quantity: number;
  minQuantity: number;
  unit?: string | null;
  location: string | null;
  unitPrice: number;
  supplier: string | null;
}

interface ActiveRequirement {
  status: string;
  urgency: string;
  count: number;
}

interface PartRequirementDetail {
  id: number;
  partId: number | null;
  workOrderId: number | null;
  quantityNeeded: number;
  reason: string;
  urgency: string;
  status: string;
  requestedBy: number | null;
  estimatedCost: string | null;
  notes: string | null;
  createdAt: string;
  partName: string | null;
  partReference: string | null;
  vehicleRegistration: string | null;
  requesterName: string | null;
}

interface PartTableProps {
  onRowClick?: (partId: number) => void;
  selectedPartId?: number | null;
}

const getNextActorInfo = (status: string, userRole: string): { actor: string; isCurrentUser: boolean; action: string; nextStatus: string } => {
  const actorMap: Record<string, { actor: string; roles: string[]; action: string; nextStatus: string }> = {
    pending: { actor: "Chef d'atelier", roles: ['admin', 'workshop_manager'], action: "Approuver ou rejeter la demande", nextStatus: "approved" },
    approved: { actor: "Magasinier", roles: ['admin', 'warehouse'], action: "Passer la commande fournisseur", nextStatus: "ordered" },
    ordered: { actor: "Magasinier", roles: ['admin', 'warehouse'], action: "Enregistrer la livraison reçue", nextStatus: "received" },
    partially_received: { actor: "Magasinier", roles: ['admin', 'warehouse'], action: "Compléter la livraison", nextStatus: "received" },
    received: { actor: "Magasinier", roles: ['admin', 'warehouse'], action: "Valider la sortie de stock pour l'OT", nextStatus: "issued" },
    cancel_requested: { actor: "Administrateur", roles: ['admin'], action: "Valider ou refuser l'annulation", nextStatus: "cancelled" },
    issued: { actor: "-", roles: [], action: "Demande terminée", nextStatus: "" },
    cancelled: { actor: "-", roles: [], action: "Demande annulée", nextStatus: "" },
    rejected: { actor: "-", roles: [], action: "Demande rejetée", nextStatus: "" },
  };
  const info = actorMap[status] || { actor: "-", roles: [], action: "-", nextStatus: "" };
  const isCurrentUser = info.roles.includes(userRole);
  return { actor: info.actor, isCurrentUser, action: info.action, nextStatus: info.nextStatus };
};

const getUrgencyLabel = (urgency: string) => {
  switch (urgency) {
    case "critical": return "Critique";
    case "high": return "Haute";
    case "medium": return "Moyenne";
    case "low": return "Basse";
    default: return urgency;
  }
};

export function PartTable({ onRowClick }: PartTableProps) {
  const [, setLocation] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState("reference");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedPartForDialog, setSelectedPartForDialog] = useState<number | null>(null);
  const [isRequirementDialogOpen, setIsRequirementDialogOpen] = useState(false);
  const [showWorkflowHelp, setShowWorkflowHelp] = useState(false);
  const itemsPerPage = 10;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const handleSortChange = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const { data, isLoading, isFetching } = useQuery<{ parts: Part[]; total: number }>({
    queryKey: [
      "/api/parts",
      {
        search: deferredSearch,
        sort_by: sortColumn,
        sort_order: sortDirection,
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage,
      },
    ],
    placeholderData: keepPreviousData,
  });

  const { data: activeRequirements = {} } = useQuery<Record<number, ActiveRequirement>>({
    queryKey: ["/api/part-requirements/active-by-part"],
  });

  const { data: partRequirements = [], isLoading: isLoadingRequirements } = useQuery<PartRequirementDetail[]>({
    queryKey: [`/api/part-requirements/by-part/${selectedPartForDialog}`],
    enabled: !!selectedPartForDialog && isRequirementDialogOpen,
  });

  const parts = data?.parts ?? [];
  const totalParts = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalParts / itemsPerPage));
  const isInitialLoad = isLoading && !data;
  const isFiltering = searchInput !== deferredSearch || (isFetching && !isInitialLoad);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/parts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      toast({ title: "Succès", description: "La pièce a été supprimée avec succès" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Erreur lors de la suppression de la pièce", variant: "destructive" });
    },
  });

  // Gardes alignées sur l'API, en moindre privilège.
  // Modifier la fiche + ajuster le stock: magasin (`isPartsCatalogManager`).
  // Supprimer une pièce: `isAdmin` côté serveur — ne pas montrer le bouton aux autres.
  const canEditParts = user?.role === 'admin' || user?.role === 'warehouse';
  const canDeleteParts = user?.role === 'admin';

  const [stockDialogPart, setStockDialogPart] = useState<Part | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState(0);

  const adjustStockMutation = useMutation({
    // Endpoint dédié: calcule `quantity + adjustment` côté serveur et trace le
    // mouvement de stock. Un PATCH direct sur la pièce ne tracerait rien.
    mutationFn: ({ id, adjustment }: { id: number; adjustment: number }) =>
      // Clé d'idempotence : un réessai après coupure ou 5xx ne rejoue pas l'ajustement.
      sendWithSubmissionKey(partStockKeyScope(id, adjustment), (key) =>
        apiRequest(`/api/parts/${id}/update-stock`, {
          method: "POST",
          headers: { [IDEMPOTENCY_HEADER]: key },
          body: { adjustment, reason: "Ajustement manuel depuis la liste des pièces" },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/inventory-value"] });
      toast({ title: "Stock mis à jour", description: "Le mouvement de stock a été enregistré." });
      setStockDialogPart(null);
      setStockAdjustment(0);
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "L'ajustement de stock n'a pas pu être enregistré."), variant: "destructive" });
    },
  });
  const submitStockAdjustment = useSingleFlightMutate(adjustStockMutation.mutate);

  const columns: PremiumDataTableColumn<Part>[] = [
    {
      id: "reference",
      header: "Référence",
      sortable: true,
      widthClassName: "whitespace-nowrap",
      cell: (part) => (
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-gray-600 whitespace-nowrap">
          {part.reference}
        </span>
      ),
    },
    {
      id: "name",
      header: "Pièce",
      sortable: true,
      widthClassName: "max-w-[200px]",
      cell: (part) => (
        <div>
          <p className="font-medium text-gray-800 leading-tight truncate">{part.name}</p>
          {part.description && (
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">{part.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "quantity",
      header: "Stock",
      sortable: true,
      cell: (part) => {
        const isLowStock = part.quantity <= part.minQuantity;
        return (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold tabular-nums ${isLowStock ? 'text-red-500' : 'text-gray-800'}`}>
              {part.quantity}
              <span className="text-[11px] font-normal text-gray-400 ml-1">{part.unit || 'pcs'}</span>
            </span>
            {isLowStock && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 whitespace-nowrap">
                <AlertCircle className="h-2.5 w-2.5" />
                min {part.minQuantity}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "unitPrice",
      header: "Prix unitaire",
      sortable: true,
      cell: (part) => (
        <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatPrice(part.unitPrice)}</span>
      ),
    },
    {
      id: "location",
      header: "Emplacement",
      sortable: true,
      cell: (part) =>
        part.location ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 whitespace-nowrap">
            {part.location}
          </span>
        ) : (
          <span className="text-gray-300 text-xs select-none">—</span>
        ),
    },
    {
      id: "supplier",
      header: "Fournisseur",
      sortable: true,
      cell: (part) =>
        part.supplier ? (
          <span className="text-sm text-gray-600 truncate max-w-[140px] block">{part.supplier}</span>
        ) : (
          <span className="text-gray-300 text-xs select-none">—</span>
        ),
    },
    {
      id: "requirementStatus",
      header: "Statut demande",
      cell: (part) => {
        const requirement = activeRequirements[part.id];
        if (!requirement) {
          return <span className="text-gray-300 text-xs select-none">—</span>;
        }
        const config = getPartRequirementStatusConfig(requirement.status);
        const StatusIcon = config.icon;
        const urgencyRing = getRequirementUrgencyBorderColor(requirement.urgency);
        const actorInfo = getNextActorInfo(requirement.status, user?.role || '');
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 cursor-pointer hover:brightness-95 transition-all ${config.color} ${urgencyRing}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPartForDialog(part.id);
                    setIsRequirementDialogOpen(true);
                  }}
                  data-testid={`badge-reappro-${part.id}`}
                >
                  <StatusIcon className="h-3 w-3" />
                  <span>{config.label}</span>
                  {requirement.count > 1 && (
                    <span className="bg-white/60 rounded-full px-1 text-[10px] font-bold">×{requirement.count}</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium text-xs">Cliquez pour voir les détails</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {actorInfo.isCurrentUser
                    ? <span className="text-green-600 font-medium">Vous devez agir sur cette demande</span>
                    : <>En attente de : {actorInfo.actor}</>
                  }
                </p>
                {requirement.count > 1 && <p className="text-xs mt-0.5">{requirement.count} demandes en cours</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      cell: (part) => (
        <TooltipProvider>
        <div className="flex items-center justify-end gap-0.5">
          {/* Bouton Voir la fiche pour tous les utilisateurs */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLocation(`/inventory/${part.id}`); }}
                aria-label={`Voir la fiche de ${part.name}`}
                data-testid={`btn-view-part-${part.id}`}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Voir la fiche détaillée</TooltipContent>
          </Tooltip>

          {/* Bouton Demander cette pièce (Chef d'atelier / Technicien / Admin) */}
          {(user?.role === "workshop_manager" || user?.role === "technician" || user?.role === "admin") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRowClick) {
                      onRowClick(part.id);
                    } else {
                      setLocation(`/inventory-requests?partId=${part.id}`);
                    }
                  }}
                  aria-label={`Demander la pièce ${part.name}`}
                  data-testid={`btn-request-part-${part.id}`}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Demander cette pièce (Besoin OT)</TooltipContent>
            </Tooltip>
          )}

          {canEditParts && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-500 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setStockDialogPart(part); setStockAdjustment(0); }}
                    aria-label={`Ajuster le stock de ${part.name}`}
                    data-testid={`btn-adjust-stock-${part.id}`}
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
                    onClick={(e) => { e.stopPropagation(); setLocation(`/inventory/${part.id}?tab=edit`); }}
                    aria-label={`Modifier ${part.name}`}
                    data-testid={`btn-edit-part-${part.id}`}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Modifier la fiche</TooltipContent>
              </Tooltip>
            </>
          )}
          {canDeleteParts && (
            <>
              <AlertDialog>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Supprimer ${part.name}`}
                        data-testid={`btn-delete-part-${part.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Supprimer la pièce</TooltipContent>
                </Tooltip>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
                    <AlertDialogDescription>
                      Êtes-vous sûr de vouloir supprimer la pièce "{part.name}" ? Cette action est irréversible.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate(part.id)}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
        </TooltipProvider>
      ),
    },
  ];

  return (
    <>
      {showWorkflowHelp && (
        <PartRequirementStatusHelp onClose={() => setShowWorkflowHelp(false)} />
      )}

      <Dialog
        open={stockDialogPart !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStockDialogPart(null);
            setStockAdjustment(0);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajuster le stock</DialogTitle>
            <DialogDescription>
              {stockDialogPart
                ? `${stockDialogPart.name} — réf. ${stockDialogPart.reference}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {stockDialogPart && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Stock actuel</p>
                  <p className="text-sm font-semibold text-gray-800">{stockDialogPart.quantity} unité(s)</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-0.5">Après ajustement</p>
                  <p className="font-bold text-[15px] text-green-700">
                    {Math.max(0, stockDialogPart.quantity + stockAdjustment)} unité(s)
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="stock-adjustment" className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
                  Ajustement
                </label>
                <input
                  id="stock-adjustment"
                  type="number"
                  value={stockAdjustment}
                  onChange={(e) => setStockAdjustment(parseInt(e.target.value, 10) || 0)}
                  placeholder="+ pour ajouter, - pour retirer"
                  data-testid="input-stock-adjustment"
                  className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400"
                />
                <p className="text-[11px] text-gray-400">
                  Le mouvement de stock sera enregistré et tracé à votre nom.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStockDialogPart(null)}>
                  Annuler
                </Button>
                <Button
                  disabled={stockAdjustment === 0 || adjustStockMutation.isPending}
                  onClick={() =>
                    submitStockAdjustment({ id: stockDialogPart.id, adjustment: stockAdjustment })
                  }
                  data-testid="button-confirm-stock-adjustment"
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
        rows={isInitialLoad ? [] : parts}
        rowKey={(part) => part.id}
        excelHeader
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onRowClick={onRowClick ? (part) => onRowClick(part.id) : undefined}
        rowClassName={(part) => {
          const isLowStock = part.quantity <= part.minQuantity;
          return [
            isLowStock
              ? "border-l-2 border-l-red-400 bg-red-50/30 hover:bg-red-50/60"
              : "border-l-2 border-l-transparent",
            isFiltering ? "opacity-70" : "",
          ].join(" ");
        }}
        tableContainerClassName="max-h-[560px]"
        emptyState={
          isInitialLoad ? (
            "Chargement des pièces..."
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400 py-4">
              <Package className="h-9 w-9 opacity-30" />
              <p className="text-sm font-medium">Aucune pièce trouvée</p>
              <p className="text-xs">Essayez de modifier votre recherche</p>
            </div>
          )
        }
        toolbar={
          <div className="w-full flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  data-help-target="inventory-search"
                  className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
                  placeholder="Rechercher une pièce..."
                  onChange={(e) => { setSearchInput(e.target.value); setCurrentPage(1); }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowWorkflowHelp((open) => !open)}
                className={[
                  "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                  showWorkflowHelp
                    ? "bg-blue-100 text-blue-700 ring-2 ring-blue-200"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100",
                ].join(" ")}
                aria-label="Comprendre la colonne Statut demande"
                aria-expanded={showWorkflowHelp}
                data-testid="toggle-workflow-help"
                title="Comprendre la colonne « Statut demande »"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
            {isFiltering && (
              <span className="text-xs text-gray-400">Filtrage…</span>
            )}
            {totalParts > 0 && (
              <span className="text-xs text-gray-400 ml-auto">{totalParts} pièce{totalParts > 1 ? 's' : ''}</span>
            )}
          </div>
        }
        footer={
          totalPages > 0 ? (
            <div className="w-full flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {totalParts > 0
                  ? <>Affichage {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, totalParts)} sur {totalParts}</>
                  : "Aucun élément"}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  <span className="px-3 py-1 text-xs text-gray-500 font-medium">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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

      <Dialog open={isRequirementDialogOpen} onOpenChange={setIsRequirementDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Demandes de pièces
            </DialogTitle>
            <DialogDescription>Détails des demandes en cours pour cette pièce</DialogDescription>
          </DialogHeader>

          {isLoadingRequirements ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : partRequirements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucune demande active pour cette pièce</div>
          ) : (
            <div className="space-y-4">
              {partRequirements.map((req) => {
                const config = getPartRequirementStatusConfig(req.status);
                const StatusIcon = config.icon;
                const actorInfo = getNextActorInfo(req.status, user?.role || '');
                const isFinalStatus = ['issued', 'cancelled', 'rejected'].includes(req.status);

                return (
                  <div
                    key={req.id}
                    className={`p-4 rounded-xl border ${actorInfo.isCurrentUser && !isFinalStatus ? 'border-green-400 bg-green-50' : 'border-gray-100 bg-gray-50'}`}
                    data-testid={`requirement-detail-${req.id}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {config.label}
                      </div>
                      <Badge variant={req.urgency === 'critical' ? 'destructive' : req.urgency === 'high' ? 'warning' : 'secondary'}>
                        Urgence : {getUrgencyLabel(req.urgency)}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-sm mb-4">
                      {[
                        { icon: FileText, label: "Demande #", val: req.id },
                        { icon: User, label: "Demandeur", val: req.requesterName || 'N/A' },
                        { icon: Package, label: "Quantité", val: req.quantityNeeded },
                        req.workOrderId && { icon: Wrench, label: "OT #", val: req.workOrderId },
                        req.vehicleRegistration && { icon: Truck, label: "Véhicule", val: req.vehicleRegistration },
                        { icon: Clock, label: "Date", val: new Date(req.createdAt).toLocaleDateString('fr-FR') },
                      ].filter(Boolean).map((item: any, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="text-gray-400">{item.label} :</span>
                          <span className="font-medium text-gray-700">{item.val}</span>
                        </div>
                      ))}
                    </div>

                    {req.reason && (
                      <div className="mb-3 px-3 py-2 bg-white rounded-lg border border-gray-100 text-sm text-gray-600">
                        <span className="text-gray-400">Motif : </span>{req.reason}
                      </div>
                    )}

                    {!isFinalStatus && (
                      <div className={`px-3 py-2.5 rounded-xl text-sm ${actorInfo.isCurrentUser ? 'bg-green-100 border border-green-300' : 'bg-white border border-gray-100'}`}>
                        <div className="flex items-center gap-2 mb-1 font-medium text-gray-700">
                          <ArrowRight className="h-3.5 w-3.5" />
                          Prochaine étape
                        </div>
                        <p className="text-gray-600">{actorInfo.action}</p>
                        <div className="mt-1.5">
                          {actorInfo.isCurrentUser ? (
                            <span className="text-green-700 font-medium flex items-center gap-1 text-xs">
                              <CheckCircle className="h-3.5 w-3.5" />
                              C'est à vous d'agir ! Allez dans Gestion des demandes.
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">En attente de : <span className="font-medium text-gray-600">{actorInfo.actor}</span></span>
                          )}
                        </div>
                      </div>
                    )}

                    {isFinalStatus && (
                      <div className="px-3 py-2 rounded-xl bg-white border border-gray-100 text-sm text-gray-600">
                        {req.status === 'issued' && <><CheckCircle className="inline h-4 w-4 mr-1 align-text-bottom" aria-hidden />Demande terminée — pièce sortie du stock</>}
                        {req.status === 'cancelled' && <><XCircle className="inline h-4 w-4 mr-1 align-text-bottom" aria-hidden />Demande annulée</>}
                        {req.status === 'rejected' && <><XCircle className="inline h-4 w-4 mr-1 align-text-bottom" aria-hidden />Demande rejetée</>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsRequirementDialogOpen(false)}>Fermer</Button>
            <Button onClick={() => { setIsRequirementDialogOpen(false); setLocation("/inventory-requests"); }}>
              Voir toutes les demandes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
