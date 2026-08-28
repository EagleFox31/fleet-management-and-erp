import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { PartTable } from "@/components/inventory/part-table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Search, Plus, Download, ShoppingCart, X, Package, Truck, LogOut, ClipboardList, ArrowUpDown, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { exportInventoryToPDF } from "@/lib/pdf-export";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { partRequirementDraft } from "@/lib/form-drafts";

// Schema pour le formulaire de demande de pièces
const partRequirementSchema = z.object({
  quantityNeeded: z.number().min(1, "La quantité doit être d'au moins 1"),
  reason: z.string().min(1, "La raison est obligatoire"),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  notes: z.string().optional(),
});

type PartRequirementForm = z.infer<typeof partRequirementSchema>;

export default function InventoryIndex() {
  const [, setLocation] = useLocation();
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const isWorkshopManager = user?.role === 'workshop_manager';
  const canEditParts = user?.role === 'admin' || user?.role === 'warehouse';
  
  // Fetch inventory statistics (filtered if a part is selected)
  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: selectedPartId 
      ? ["/api/parts/statistics", { partId: selectedPartId }]
      : ["/api/parts/statistics"],
  });
  
  // Fetch low stock parts
  const { data: lowStockParts = [], isLoading: lowStockLoading } = useQuery<any>({
    queryKey: ["/api/parts/low-on-stock"],
  });
  
  // Fetch selected part details
  const { data: selectedPart } = useQuery<any>({
    queryKey: selectedPartId ? [`/api/parts/${selectedPartId}`] : [],
    enabled: !!selectedPartId,
  });
  
  // Fetch part requirements for workshop manager stats
  const { data: allRequirements = [], isLoading: requirementsLoading } = useQuery<any[]>({
    queryKey: ["/api/part-requirements"],
    enabled: isWorkshopManager,
  });
  
  // Fetch stock movements for this month
  const { data: stockMovements = [], isLoading: stockMovementsLoading } = useQuery<any[]>({
    queryKey: ["/api/parts/stock-movements"],
    enabled: isWorkshopManager,
  });
  
  // Calculate workshop manager specific stats
  const myRequestsCount = isWorkshopManager 
    ? allRequirements.filter((r: any) => r.requestedBy === user?.id).length 
    : 0;
  const pendingRequestsCount = isWorkshopManager 
    ? allRequirements.filter((r: any) => r.status === 'pending').length 
    : 0;
  const thisMonthMovements = isWorkshopManager && Array.isArray(stockMovements)
    ? stockMovements.filter((m: any) => {
        const movementDate = new Date(m.createdAt || m.date);
        const now = new Date();
        return movementDate.getMonth() === now.getMonth() && 
               movementDate.getFullYear() === now.getFullYear();
      }).length
    : 0;
  
  const handleAddPart = () => {
    setLocation("/inventory/new");
  };
  
  const handlePartSelect = (partId: number) => {
    setSelectedPartId(partId === selectedPartId ? null : partId);
  };

  // Formulaire pour demander une pièce
  const form = useForm<PartRequirementForm>({
    resolver: zodResolver(partRequirementSchema),
    defaultValues: {
      quantityNeeded: 1,
      reason: "",
      urgency: "medium",
      notes: "",
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: partRequirementDraft.storage as any,
    isEmpty: partRequirementDraft.isEmpty as any,
    userId: user?.id,
  });

  // Mutation pour créer une demande de pièce
  const createRequirementMutation = useMutation({
    mutationFn: (data: PartRequirementForm) =>
      apiRequest("POST", "/api/part-requirements", {
        ...data,
        partId: selectedPartId,
      }),
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: "Demande enregistrée",
        description: "Votre demande de pièce a été enregistrée avec succès.",
      });
      form.reset();
      setIsRequestDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de l'enregistrement: ${error.message}`,
      });
    },
  });

  const onSubmitRequirement = (data: PartRequirementForm) => {
    createRequirementMutation.mutate(data);
  };

  // Fonction d'export PDF
  const handleExportPDF = async () => {
    try {
      const response = await fetch('/api/parts?limit=1000');
      if (!response.ok) {
        throw new Error('Erreur lors de la récupération des données');
      }
      const data = await response.json();
      const allParts = data.parts || data;
      exportInventoryToPDF(allParts);
      toast({
        title: "Export réussi",
        description: "L'inventaire a été exporté en PDF avec succès.",
      });
    } catch (error) {
      console.error('Erreur export PDF:', error);
      toast({
        variant: "destructive",
        title: "Erreur d'export",
        description: "Une erreur s'est produite lors de l'export PDF.",
      });
    }
  };
  
  const totalStockValue = selectedPartId && selectedPart 
    ? (selectedPart as any).quantity * parseFloat((selectedPart as any).unitPrice) 
    : (stats as any)?.totalValue || 0;
  const totalItems = selectedPartId && selectedPart 
    ? (selectedPart as any).quantity 
    : (stats as any)?.totalItems || 0;
  const lowStockCount = selectedPartId 
    ? (selectedPart && (selectedPart as any).quantity <= (selectedPart as any).minQuantity ? 1 : 0)
    : (lowStockParts as any).length;

  const isInitialLoading = Boolean(
    statsLoading ||
      lowStockLoading ||
      (isWorkshopManager && (requirementsLoading || stockMovementsLoading)),
  );

  if (isInitialLoading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="px-5 py-5 md:px-7 md:py-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-56" />
              </div>
              <Skeleton className="h-9 w-28" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5 border-t border-gray-100">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5">
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-5">

      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">

          {/* Title + actions */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Stock & Magasin</span>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Inventaire des pièces</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">Gestion du stock des pièces détachées</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportPDF}>
                <Download className="h-4 w-4 mr-1.5" />
                PDF
              </Button>
              {canEditParts && (
                <Button size="sm" onClick={handleAddPart} data-testid="header-btn-add-part">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Ajouter une pièce
                </Button>
              )}
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5 border-t border-gray-100">
            {/* Stock */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <Package className="h-4 w-4 text-green-600" />
              </div>
              <div className="mt-1">
                <p className="text-[11px] font-medium text-gray-500">{selectedPartId ? "Quantité" : "Pièces en stock"}</p>
                <p className="text-[15px] font-bold text-gray-800 leading-tight mt-0.5">{totalItems}</p>
              </div>
            </div>

            {/* Rupture / Demandes */}
            {isWorkshopManager ? (
              <div
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setLocation('/inventory-requests')}
                data-testid="kpi-pending-requests"
              >
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                    <ClipboardList className="h-4 w-4 text-orange-500" />
                  </div>
                  <ExternalLink className="h-3 w-3 text-gray-400" />
                </div>
                <div className="mt-1">
                  <p className="text-[11px] font-medium text-gray-500">Demandes en attente</p>
                  <p className={`text-[15px] font-bold leading-tight mt-0.5 ${pendingRequestsCount > 0 ? 'text-orange-700' : 'text-gray-800'}`}>{pendingRequestsCount}</p>
                </div>
              </div>
            ) : (
              <div className={`rounded-xl border px-4 py-3.5 flex flex-col gap-1 ${lowStockCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`} data-help-target="inventory-alerts">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${lowStockCount > 0 ? 'bg-amber-100' : 'bg-gray-100'}`}>
                  <LogOut className={`h-4 w-4 ${lowStockCount > 0 ? 'text-amber-600' : 'text-gray-500'}`} />
                </div>
                <div className="mt-1">
                  <p className={`text-[11px] font-medium ${lowStockCount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                    {selectedPartId ? "Statut stock" : "En rupture de stock"}
                  </p>
                  <p className={`text-[15px] font-bold leading-tight mt-0.5 ${lowStockCount > 0 ? 'text-amber-800' : 'text-gray-800'}`}>{lowStockCount}</p>
                </div>
              </div>
            )}

            {/* Valeur / Mouvements */}
            {isWorkshopManager ? (
              <div
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setLocation('/inventory/movements')}
                data-testid="kpi-movements"
              >
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                    <ArrowUpDown className="h-4 w-4 text-teal-600" />
                  </div>
                  <ExternalLink className="h-3 w-3 text-gray-400" />
                </div>
                <div className="mt-1">
                  <p className="text-[11px] font-medium text-gray-500">Mouvements ce mois</p>
                  <p className="text-[15px] font-bold text-gray-800 leading-tight mt-0.5">{thisMonthMovements}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Truck className="h-4 w-4 text-blue-500" />
                </div>
                <div className="mt-1">
                  <p className="text-[11px] font-medium text-gray-500">{selectedPartId ? "Valeur de la pièce" : "Valeur du stock"}</p>
                  <p className="text-[15px] font-bold text-gray-800 leading-tight mt-0.5">{formatPrice(totalStockValue)}</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Active filter bar ── */}
      {selectedPartId && selectedPart && (
        <div className="rounded-2xl border border-green-100 bg-white shadow-sm px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
              <Package className="h-3.5 w-3.5 text-green-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Filtre actif</p>
              <p className="text-sm font-semibold text-gray-800 leading-tight">
                {(selectedPart as any).name}{" "}
                <span className="text-gray-400 font-normal text-xs">({(selectedPart as any).reference})</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant={(selectedPart as any).quantity <= (selectedPart as any).minQuantity ? "destructive" : "outline"}
                  size="sm"
                >
                  <ShoppingCart className="h-4 w-4 mr-1.5" />
                  {(selectedPart as any).quantity <= (selectedPart as any).minQuantity ? "Stock bas — Demander" : "Demander cette pièce"}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden rounded-2xl">
                {/* Header premium */}
                <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
                <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center">
                      <ShoppingCart className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">Demander une pièce</h2>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {(selectedPart as any).name} · <span className="font-mono">{(selectedPart as any).reference}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitRequirement)} className="px-6 py-5 space-y-4">
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
                    <FormField
                      control={form.control}
                      name="quantityNeeded"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quantité nécessaire</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              className="rounded-xl border-gray-200 focus:border-green-400 focus:ring-green-400/20"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-500">Raison du besoin</FormLabel>
                          <FormControl>
                            <Input className="rounded-xl border-gray-200 focus:border-green-400 focus:ring-green-400/20" placeholder="Ex: Maintenance préventive, réparation urgente..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="urgency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-500">Urgence</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="rounded-xl border-gray-200">
                                <SelectValue placeholder="Sélectionner l'urgence" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Faible</SelectItem>
                              <SelectItem value="medium">Moyenne</SelectItem>
                              <SelectItem value="high">Haute</SelectItem>
                              <SelectItem value="critical">Critique</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes <span className="normal-case font-normal text-gray-400">(optionnel)</span></FormLabel>
                          <FormControl>
                            <Textarea className="rounded-xl border-gray-200 focus:border-green-400 focus:ring-green-400/20 resize-none" rows={3} placeholder="Informations supplémentaires..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => setIsRequestDialogOpen(false)}>Annuler</Button>
                      <Button type="submit" className="rounded-xl bg-green-600 hover:bg-green-700 text-white" disabled={createRequirementMutation.isPending}>
                        {createRequirementMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-gray-700" onClick={() => setSelectedPartId(null)}>
              <X className="h-4 w-4 mr-1" />
              Effacer
            </Button>
          </div>
        </div>
      )}

      {/* ── Parts table ── */}
      <div data-help-target="inventory-table">
      <PartTable onRowClick={handlePartSelect} selectedPartId={selectedPartId} />
      </div>

    </div>
  );
}
