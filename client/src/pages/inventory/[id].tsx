import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PartForm } from "@/components/inventory/part-form";
import { formatPrice, translateStatus } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowLeft, TrendingUp, TrendingDown, FileText, Download, Package, Wrench, Calendar, BarChart3, Eye, Pencil } from "lucide-react";

interface PartDetailsParams {
  params: { id: string };
}

/** Onglets acceptés dans `?tab=` — évite d'activer un onglet inexistant depuis l'URL. */
const VALID_PART_TABS = ["overview", "history", "workorders", "details", "edit"];

export default function PartDetails({ params }: PartDetailsParams) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUpdateStockDialogOpen, setIsUpdateStockDialogOpen] = useState(false);
  const [stockUpdateAmount, setStockUpdateAmount] = useState(0);
  // Onglet initial pilotable par l'URL (?tab=edit) pour permettre l'accès direct
  // à l'édition depuis la liste des pièces, et rendre l'onglet partageable.
  const searchString = useSearch();
  const [activeTab, setActiveTab] = useState(() => {
    const requestedTab = new URLSearchParams(searchString).get("tab");
    return requestedTab && VALID_PART_TABS.includes(requestedTab) ? requestedTab : "overview";
  });
  
  const canEditParts = user?.role === 'admin' || user?.role === 'warehouse';
  
  const partId = parseInt(params.id);

  const getWorkOrderStatusLabel = (status?: string) => {
    if (!status) return "Inconnu";
    return translateStatus(status);
  };
  
  // Fetch part details
  const { data: part, isLoading, error } = useQuery<any>({
    queryKey: [`/api/parts/${partId}`],
    enabled: !isNaN(partId),
  });
  
  // Fetch usage history
  const { data: usageHistory = [] } = useQuery<any>({
    queryKey: [`/api/parts/${partId}/usage-history`],
    enabled: !!partId,
  });
  
  // Fetch work orders using this part
  const { data: workOrders = [] } = useQuery<any>({
    queryKey: [`/api/parts/${partId}/work-orders`],
    enabled: !!partId,
  });

  // Fetch stock history
  const { data: stockHistory = [] } = useQuery<any>({
    queryKey: [`/api/parts/${partId}/stock-history`],
    enabled: !!partId,
    staleTime: 0, // Force refresh to get enriched data
  });
  
  const deletePartMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/parts/${partId}`);
    },
    onSuccess: () => {
      toast({
        title: "Pièce supprimée",
        description: "La pièce a été supprimée avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      setLocation("/inventory");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de la suppression: ${error.message}`,
      });
    },
  });
  
  const updateStockMutation = useMutation({
    // Endpoint dédié: il calcule `quantity + adjustment` côté serveur ET trace
    // le mouvement de stock. Ne pas repasser par PATCH /api/parts/:id, qui ne
    // connaît pas de champ `currentStock` et laisserait l'ajustement sans effet.
    mutationFn: async () => {
      return apiRequest("POST", `/api/parts/${partId}/update-stock`, {
        adjustment: stockUpdateAmount,
        reason: "Ajustement manuel depuis la fiche pièce",
      });
    },
    onSuccess: () => {
      toast({
        title: "Stock mis à jour",
        description: `Le stock a été ${stockUpdateAmount >= 0 ? "augmenté" : "diminué"} de ${Math.abs(stockUpdateAmount)} unité(s).`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      setIsUpdateStockDialogOpen(false);
      setStockUpdateAmount(0);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de la mise à jour du stock: ${error.message}`,
      });
    },
  });
  
  const handleDelete = () => {
    deletePartMutation.mutate();
    setIsDeleteDialogOpen(false);
  };
  
  const handleUpdateStock = () => {
    updateStockMutation.mutate();
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }
  
  if (error) {
    console.error("Erreur lors du chargement de la pièce:", error);
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-semibold">Erreur de chargement</h2>
        <p className="text-muted-foreground mt-2">
          Une erreur est survenue lors du chargement de la pièce.
        </p>
        <Button 
          className="mt-4" 
          onClick={() => setLocation("/inventory")}
        >
          Retour à l'inventaire
        </Button>
      </div>
    );
  }
  
  if (!part) {
    console.log("Données de la pièce:", part, "Loading:", isLoading, "Error:", error);
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-semibold">Pièce non trouvée</h2>
        <p className="text-muted-foreground mt-2">
          La pièce que vous recherchez n'existe pas ou a été supprimée.
        </p>
        <Button 
          className="mt-4" 
          onClick={() => setLocation("/inventory")}
        >
          Retour à l'inventaire
        </Button>
      </div>
    );
  }
  
  const isLowStock = part.quantity <= part.minQuantity;
  const stockLevel = part.quantity / part.minQuantity * 100;
  const totalValue = part.quantity * parseFloat(part.unitPrice || '0');
  const creatorLabel = part.createdByName || (part.createdBy ? `Utilisateur #${part.createdBy}` : "Système");
  
  // Calculate KPIs
  const consumptionRate = usageHistory.length > 0 ? usageHistory.reduce((sum: number, item: any) => sum + item.quantity, 0) / 30 : 0;
  const daysRemaining = consumptionRate > 0 ? Math.floor(part.quantity / consumptionRate) : 999;
  
  const handleExportPDF = () => {
    toast({
      title: "Export PDF",
      description: "Fonctionnalité d'export PDF en cours de développement",
    });
  };

  const getMovementActorLabel = (movement: any) => {
    if (movement.technicianName) {
      return movement.technicianName;
    }
    if (movement.createdByName) {
      return movement.createdByName;
    }
    if (movement.createdBy) {
      return `Utilisateur #${movement.createdBy}`;
    }
    return "Système";
  };

  const stockHistoryTimeline = [...(Array.isArray(stockHistory) ? stockHistory : [])]
    .filter((movement: any) => movement?.createdAt)
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((movement: any) => {
      const createdAt = new Date(movement.createdAt);
      return {
        ...movement,
        stock: Number(movement.newStock),
        chartDate: createdAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        chartTime: createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        chartDateTime: createdAt.toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        movementDelta: Number(movement.newStock) - Number(movement.previousStock),
        inQty: movement.movementType === 'in' ? Math.abs(Number(movement.quantity) || Math.abs(Number(movement.newStock) - Number(movement.previousStock))) : undefined,
        outQty: movement.movementType === 'out' ? Math.abs(Number(movement.quantity) || Math.abs(Number(movement.newStock) - Number(movement.previousStock))) : undefined,
        adjustQty: (movement.movementType === 'adjustment' || movement.movementType === 'initial') ? Math.abs(Number(movement.newStock) - Number(movement.previousStock)) : undefined,
      };
    });
  
  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">

          {/* Retour + Actions */}
          <div className="flex items-start justify-between mb-5">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/inventory")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Inventaire
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportPDF} data-testid="button-export-pdf">
                <Download className="h-4 w-4 mr-1.5" />
                PDF
              </Button>
              {canEditParts && (
                <>
                  <Dialog open={isUpdateStockDialogOpen} onOpenChange={setIsUpdateStockDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="button-adjust-stock">
                        <Package className="h-4 w-4 mr-1.5" />
                        Ajuster le stock
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Ajuster le stock</DialogTitle>
                        <DialogDescription>Ajoutez ou retirez des pièces du stock.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Stock actuel</Label>
                          <div className="text-lg font-medium">{part.quantity} unité(s)</div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="stockAmount">Ajustement</Label>
                          <Input
                            id="stockAmount"
                            type="number"
                            value={stockUpdateAmount}
                            onChange={(e) => setStockUpdateAmount(parseInt(e.target.value) || 0)}
                            placeholder="+ pour ajouter, - pour retirer"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Nouveau stock</Label>
                          <div className="text-lg font-medium">{Math.max(0, part.quantity + stockUpdateAmount)} unité(s)</div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsUpdateStockDialogOpen(false)}>Annuler</Button>
                        <Button onClick={handleUpdateStock} disabled={stockUpdateAmount === 0 || updateStockMutation.isPending}>
                          {updateStockMutation.isPending ? "Mise à jour..." : "Confirmer"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm" data-testid="button-delete-part">
                        Supprimer
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Confirmer la suppression</DialogTitle>
                        <DialogDescription>
                          Êtes-vous sûr de vouloir supprimer cette pièce ? Cette action est irréversible.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Annuler</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={deletePartMutation.isPending}>
                          {deletePartMutation.isPending ? "Suppression..." : "Supprimer"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
              )}
            </div>
          </div>

          {/* Badge état stock */}
          <div className="flex items-center gap-2 mb-4">
            {isLowStock && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                <AlertTriangle className="w-3 h-3" />
                Stock bas
              </span>
            )}
            {part.category && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">
                {part.category}
              </span>
            )}
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
              <Package className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Pièce détachée</span>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{part.name}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Réf: {part.reference} • {part.location || 'Emplacement non défini'} • Créé par {creatorLabel}
              </p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              {
                icon: <Package className="h-4 w-4 text-green-600" />, iconBg: "bg-green-50",
                label: "Stock actuel",
                value: `${part.quantity} unité${part.quantity > 1 ? 's' : ''}`,
                sub: <><Progress value={Math.min(stockLevel, 100)} className="h-1 mt-2 mb-1" /><span className="text-[10px] text-gray-400">{stockLevel.toFixed(0)}% du seuil min.</span></>,
              },
              {
                icon: <BarChart3 className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50",
                label: "Valeur stock",
                value: formatPrice(totalValue),
                sub: <span className="text-[10px] text-gray-400">{formatPrice(part.unitPrice)} × {part.quantity}</span>,
              },
              {
                icon: <FileText className="h-4 w-4 text-purple-500" />, iconBg: "bg-purple-50",
                label: "Prix unitaire",
                value: formatPrice(part.unitPrice),
                sub: <span className="text-[10px] text-gray-400">par unité</span>,
              },
              {
                icon: <TrendingDown className="h-4 w-4 text-orange-500" />, iconBg: "bg-orange-50",
                label: "Consommation",
                value: `${consumptionRate.toFixed(1)} / jour`,
                sub: <span className="text-[10px] text-gray-400">moyenne 30 jours</span>,
              },
              {
                icon: <Calendar className="h-4 w-4 text-emerald-600" />, iconBg: "bg-emerald-50",
                label: "Autonomie",
                value: daysRemaining > 365 ? "∞" : `${daysRemaining} j`,
                sub: <span className={`text-[10px] font-medium ${daysRemaining < 30 ? "text-red-500" : "text-gray-400"}`}>
                  {daysRemaining < 30 ? "Réappro. urgente !" : "Délai estimé"}
                </span>,
              },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
                <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                  {kpi.icon}
                </div>
                <div className="mt-1">
                  <p className="text-[11px] font-medium text-gray-500">{kpi.label}</p>
                  <p className="text-[15px] font-bold text-gray-800 leading-tight mt-0.5">{kpi.value}</p>
                  {kpi.sub}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
      
      {/* Onglets */}
      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
        {/* Tab navigation bar — segmented control style */}
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-white px-2 py-2 mb-5">
          <TabsList className="flex w-full bg-transparent p-0 h-auto gap-1">
            <TabsTrigger
              value="overview"
              className="flex-1 rounded-xl text-sm py-2.5 px-3 font-medium text-gray-500 data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-gray-800 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            >
              <BarChart3 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Vue d'ensemble</span>
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="flex-1 rounded-xl text-sm py-2.5 px-3 font-medium text-gray-500 data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-gray-800 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            >
              <TrendingUp className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Historique</span>
            </TabsTrigger>
            <TabsTrigger
              value="workorders"
              className="flex-1 rounded-xl text-sm py-2.5 px-3 font-medium text-gray-500 data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-gray-800 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            >
              <Wrench className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Ordres de travail</span>
            </TabsTrigger>
            <TabsTrigger
              value="details"
              className="flex-1 rounded-xl text-sm py-2.5 px-3 font-medium text-gray-500 data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-gray-800 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Fiche technique</span>
            </TabsTrigger>
            {canEditParts && (
              <TabsTrigger
                value="edit"
                className="flex-1 rounded-xl text-sm py-2.5 px-3 font-medium text-gray-500 data-[state=active]:bg-gray-900 data-[state=active]:text-white data-[state=active]:shadow-sm hover:text-gray-800 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                data-testid="tab-edit-part"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Modifier</span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Mouvements de stock */}
            <Card className="rounded-2xl border border-gray-100 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                    <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                  </div>
                  Mouvements de stock
                </CardTitle>
                <CardDescription>Derniers mouvements enregistrés</CardDescription>
              </CardHeader>
              <CardContent>
                {stockHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
                      <BarChart3 className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground mb-2">Aucun mouvement récent</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Les mouvements de stock apparaîtront ici une fois que cette pièce sera utilisée dans des ordres de travail ou que le stock sera ajusté.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {stockHistory.slice(0, 5).map((movement: any) => (
                      <div key={movement.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`h-2 w-2 rounded-full ${
                            movement.movementType === 'out' ? 'bg-red-500' : 
                            movement.movementType === 'in' ? 'bg-green-500' : 'bg-blue-500'
                          }`} />
                          <div>
                            <p className="text-sm font-medium">
                              {movement.movementType === 'out' ? 'Sortie' : 
                               movement.movementType === 'in' ? 'Entrée' : 'Ajustement'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {movement.reason || 'Mouvement de stock'}
                            </p>
                            {movement.workOrderTitle && (
                              <p className="text-xs text-blue-600 dark:text-blue-400">
                                OT: {movement.workOrderTitle}
                              </p>
                            )}
                            {(movement.technicianName || movement.createdByName || movement.createdBy) && (
                              <p className="text-xs text-purple-600 dark:text-purple-400">
                                👤 Par: {getMovementActorLabel(movement)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {movement.movementType === 'out' ? '-' : '+'}{Math.abs(movement.quantity)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(movement.createdAt).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Utilisation récente */}
            <Card className="rounded-2xl border border-gray-100 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Wrench className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  Utilisation récente
                </CardTitle>
                <CardDescription>Dernières utilisations dans les ordres de travail</CardDescription>
              </CardHeader>
              <CardContent>
                {workOrders.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
                      <Package className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground mb-2">Pièce non utilisée</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Cette pièce n'a pas encore été utilisée dans un ordre de travail. L'historique d'utilisation apparaîtra ici dès la première utilisation.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {workOrders.slice(0, 5).map((workOrder: any) => (
                      <div key={workOrder.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium text-sm">OT #{workOrder.id}</div>
                          <div className="text-xs text-muted-foreground">{workOrder.title}</div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {getWorkOrderStatusLabel(workOrder.status)}
                        </Badge>
                      </div>
                    ))}
                    {workOrders.length > 5 && (
                      <div className="text-center">
                        <Button variant="ghost" size="sm" onClick={() => setActiveTab("workorders")}>
                          Voir tous les ordres de travail
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recommandations */}
            <Card className="lg:col-span-2 rounded-2xl border border-gray-100 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  </div>
                  Recommandations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {isLowStock && (
                    <div className="p-4 border border-orange-200 rounded-lg bg-orange-50 dark:bg-orange-950">
                      <div className="flex items-center mb-2">
                        <AlertTriangle className="h-4 w-4 text-orange-600 mr-2" />
                        <span className="font-medium text-orange-800 dark:text-orange-200">Stock bas</span>
                      </div>
                      <p className="text-sm text-orange-600 dark:text-orange-300">
                        Réapprovisionnement recommandé
                      </p>
                    </div>
                  )}
                  
                  {!part.location && (
                    <div className="p-4 border border-blue-200 rounded-lg bg-blue-50 dark:bg-blue-950">
                      <div className="flex items-center mb-2">
                        <Package className="h-4 w-4 text-blue-600 mr-2" />
                        <span className="font-medium text-blue-800 dark:text-blue-200">Emplacement</span>
                      </div>
                      <p className="text-sm text-blue-600 dark:text-blue-300">
                        Définir un emplacement de stockage
                      </p>
                    </div>
                  )}
                  
                  {!part.supplier && (
                    <div className="p-4 border border-purple-200 rounded-lg bg-purple-50 dark:bg-purple-950">
                      <div className="flex items-center mb-2">
                        <FileText className="h-4 w-4 text-purple-600 mr-2" />
                        <span className="font-medium text-purple-800 dark:text-purple-200">Fournisseur</span>
                      </div>
                      <p className="text-sm text-purple-600 dark:text-purple-300">
                        Ajouter les informations fournisseur
                      </p>
                    </div>
                  )}
                </div>
                
                {!isLowStock && part.location && part.supplier && (
                  <div className="text-center py-8">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 mb-4">
                      <Package className="h-6 w-6 text-green-600" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground mb-2">Tout va bien !</h3>
                    <p className="text-sm text-muted-foreground">
                      Cette pièce est correctement configurée et le stock est suffisant.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="history">
          <Card className="rounded-2xl border border-gray-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                  <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                </div>
                Historique des mouvements
              </CardTitle>
              <CardDescription>Suivi détaillé des entrées et sorties de stock</CardDescription>
            </CardHeader>
            <CardContent>
              {stockHistory.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
                    <TrendingUp className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Aucun historique disponible</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    L'historique des mouvements de stock sera automatiquement enregistré lors des ajustements de stock et de l'utilisation dans les ordres de travail.
                  </p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={() => setIsUpdateStockDialogOpen(true)}
                  >
                    Ajuster le stock
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Graphique d'évolution du stock */}
                  <div className="rounded-xl bg-gray-50 border-0 p-3 flex items-center gap-3 text-[11px] text-gray-500">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-green-500"></span>Entrées</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-red-500"></span>Sorties</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-indigo-500"></span>Ajustements</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-blue-600"></span>Niveau de stock</span>
                    <span className="flex items-center gap-1.5 ml-auto"><span className="inline-block w-4 border-t-2 border-dashed border-orange-400"></span>Seuil minimum</span>
                  </div>
                  <div className="flex gap-3 items-stretch">
                    {/* Chart */}
                    <div className="flex-1 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={stockHistoryTimeline} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis
                            dataKey="chartDate"
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#9ca3af' }}
                            axisLine={false}
                            tickLine={false}
                            width={32}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '10px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                              fontSize: 12,
                            }}
                            labelFormatter={(label: any) => `${label}`}
                            formatter={(value: any, name: string) => {
                              if (name === 'Niveau de stock') return [`${value} unité${value > 1 ? 's' : ''}`, name];
                              return [`${value}`, name];
                            }}
                          />
                          <ReferenceLine
                            y={part.minQuantity}
                            stroke="#fb923c"
                            strokeDasharray="5 3"
                            strokeWidth={1.5}
                            ifOverflow="extendDomain"
                            label={{ value: `Min: ${part.minQuantity}`, position: 'insideTopRight', fontSize: 10, fill: '#fb923c', dy: -4 }}
                          />
                          <Bar dataKey="inQty" name="Entrées" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={20} />
                          <Bar dataKey="outQty" name="Sorties" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={20} />
                          <Bar dataKey="adjustQty" name="Ajustements" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={20} />
                          <Line
                            type="stepAfter"
                            dataKey="stock"
                            name="Niveau de stock"
                            stroke="#2563eb"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }}
                            activeDot={{ r: 5, stroke: '#2563eb', strokeWidth: 2, fill: '#fff' }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Summary panel */}
                    {(() => {
                      const inMvts = stockHistory.filter((m: any) => m.movementType === 'in');
                      const outMvts = stockHistory.filter((m: any) => m.movementType === 'out');
                      const adjMvts = stockHistory.filter((m: any) => m.movementType === 'adjustment' || m.movementType === 'initial');
                      const totalIn = inMvts.reduce((s: number, m: any) => s + Math.abs(Number(m.quantity) || 0), 0);
                      const totalOut = outMvts.reduce((s: number, m: any) => s + Math.abs(Number(m.quantity) || 0), 0);
                      const totalAdj = adjMvts.reduce((s: number, m: any) => s + Math.abs(Number(m.newStock) - Number(m.previousStock)), 0);
                      const net = totalIn - totalOut;
                      return (
                        <div className="w-36 shrink-0 flex flex-col gap-2">
                          <div className="rounded-xl bg-green-50 px-3 py-2.5 flex flex-col flex-1">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-green-700 mb-0.5">Entrées</p>
                            <p className="text-2xl font-bold text-green-800 leading-none">{totalIn}</p>
                            <p className="text-[10px] text-green-600 mt-1">{inMvts.length} opération{inMvts.length > 1 ? 's' : ''}</p>
                          </div>
                          <div className="rounded-xl bg-red-50 px-3 py-2.5 flex flex-col flex-1">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-red-700 mb-0.5">Sorties</p>
                            <p className="text-2xl font-bold text-red-800 leading-none">{totalOut}</p>
                            <p className="text-[10px] text-red-600 mt-1">{outMvts.length} opération{outMvts.length > 1 ? 's' : ''}</p>
                          </div>
                          <div className="rounded-xl bg-indigo-50 px-3 py-2.5 flex flex-col flex-1">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-700 mb-0.5">Ajustements</p>
                            <p className="text-2xl font-bold text-indigo-800 leading-none">{totalAdj}</p>
                            <p className="text-[10px] text-indigo-600 mt-1">{adjMvts.length} opération{adjMvts.length > 1 ? 's' : ''}</p>
                          </div>
                          <div className={`rounded-xl px-3 py-2.5 flex flex-col flex-1 ${net >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">Solde net</p>
                            <p className={`text-2xl font-bold leading-none ${net >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                              {net >= 0 ? '+' : ''}{net}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">{stockHistory.length} mouv. total</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Liste détaillée des mouvements */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                      Détail des mouvements
                    </h4>
                    {stockHistory.map((movement) => (
                      <div key={`movement-${movement.id}`} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center space-x-4">
                          <div className={`h-3 w-3 rounded-full ${
                            movement.movementType === 'out' ? 'bg-red-500' : 
                            movement.movementType === 'in' ? 'bg-green-500' : 'bg-blue-500'
                          }`} />
                          <div>
                            <p className="font-medium text-sm">
                              <span className="inline-flex items-center gap-1.5">
                                {movement.movementType === 'out' ? (
                                  <TrendingDown className="h-3.5 w-3.5 text-red-600" />
                                ) : movement.movementType === 'in' ? (
                                  <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                                ) : (
                                  <BarChart3 className="h-3.5 w-3.5 text-blue-600" />
                                )}
                                {movement.movementType === 'out' ? 'Sortie de stock' : 
                                 movement.movementType === 'in' ? 'Entrée en stock' : 'Ajustement de stock'}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {movement.reason || 'Mouvement de stock'}
                            </p>
                            {movement.workOrderTitle && (
                              <p className="text-xs text-blue-600 dark:text-blue-400">
                                OT: {movement.workOrderTitle}
                              </p>
                            )}
                            {(movement.technicianName || movement.createdByName || movement.createdBy) && (
                              <p className="text-xs text-purple-600 dark:text-purple-400">
                                Par: {getMovementActorLabel(movement)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${
                            movement.movementType === 'out'
                              ? 'text-red-600'
                              : movement.movementType === 'in'
                                ? 'text-green-600'
                                : 'text-blue-600'
                          }`}>
                            {(() => {
                              if (movement.movementType === 'adjustment' || movement.movementType === 'initial') {
                                const delta = Number(movement.newStock) - Number(movement.previousStock);
                                return `${delta > 0 ? '+' : ''}${delta}`;
                              }
                              return `${movement.movementType === 'out' ? '-' : '+'}${Math.abs(movement.quantity)}`;
                            })()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Stock: {movement.previousStock} → {movement.newStock}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(movement.createdAt).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workorders">
          <Card className="rounded-2xl border border-gray-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Wrench className="h-3.5 w-3.5 text-blue-600" />
                </div>
                Ordres de travail associés
              </CardTitle>
              <CardDescription>Ordres de travail utilisant cette pièce</CardDescription>
            </CardHeader>
            <CardContent>
              {workOrders.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
                    <Wrench className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Aucun ordre de travail</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Cette pièce n'est associée à aucun ordre de travail. Les ordres de travail utilisant cette pièce apparaîtront automatiquement ici.
                  </p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={() => setLocation("/maintenance/work-orders/new")}
                  >
                    Créer un ordre de travail
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {workOrders.map((workOrder: any) => (
                    <div key={workOrder.id} className="relative flex overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-all group">
                      {/* Status strip */}
                      <div className={`w-1 shrink-0 ${
                        workOrder.status === 'completed' ? 'bg-green-500' :
                        workOrder.status === 'in_progress' ? 'bg-blue-500' :
                        workOrder.status === 'cancelled' ? 'bg-gray-300' :
                        'bg-amber-400'
                      }`} />
                      <div className="flex-1 px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* OT ref */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">OT #{workOrder.id}</span>
                              {workOrder.createdAt && (
                                <span className="text-[10px] text-gray-400">
                                  {new Date(workOrder.createdAt).toLocaleDateString('fr-FR')}
                                </span>
                              )}
                            </div>
                            {/* Title */}
                            <p className="text-sm font-semibold text-gray-900 leading-snug truncate">{workOrder.title}</p>
                            {workOrder.vehicleRegistration && (
                              <p className="text-xs text-gray-500 mt-0.5">{workOrder.vehicleRegistration}</p>
                            )}
                            {/* Status + Priority badges */}
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                workOrder.status === 'completed' ? 'bg-green-100 text-green-700' :
                                workOrder.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                workOrder.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                                'bg-amber-100 text-amber-700'
                              }`}>
                                {getWorkOrderStatusLabel(workOrder.status)}
                              </span>
                              {workOrder.priority && (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  workOrder.priority === 'critical' ? 'bg-red-100 text-red-700' :
                                  workOrder.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                  workOrder.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                  {workOrder.priority === 'low' ? 'Faible' :
                                   workOrder.priority === 'medium' ? 'Moyenne' :
                                   workOrder.priority === 'high' ? 'Élevée' :
                                   workOrder.priority === 'critical' ? 'Critique' : workOrder.priority}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* CTA */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-xs border-gray-200 hover:bg-gray-50 opacity-60 group-hover:opacity-100 transition-opacity"
                            onClick={() => setLocation(`/maintenance/work-orders/${workOrder.id}`)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Voir
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="details">
          <Card className="rounded-2xl border border-gray-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                  <FileText className="h-3.5 w-3.5 text-purple-600" />
                </div>
                Fiche technique
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Description — full width */}
              <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Description</p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {part.description || <span className="text-gray-400 italic">Aucune description fournie.</span>}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Référence */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Référence</p>
                  <p className="text-sm font-semibold text-gray-800">{part.reference || <span className="text-gray-400 font-normal italic">—</span>}</p>
                </div>

                {/* Catégorie */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Catégorie</p>
                  <p className="text-sm font-semibold text-gray-800">{part.category || <span className="text-gray-400 font-normal italic">—</span>}</p>
                </div>

                {/* Emplacement */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Emplacement</p>
                  <p className="text-sm font-semibold text-gray-800">{part.location || <span className="text-gray-400 font-normal italic">Non défini</span>}</p>
                </div>

                {/* Fournisseur */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Fournisseur</p>
                  <p className="text-sm font-semibold text-gray-800">{part.supplier || <span className="text-gray-400 font-normal italic">Non renseigné</span>}</p>
                </div>

                {/* Prix unitaire */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Prix unitaire</p>
                  <p className="text-sm font-semibold text-gray-800">{formatPrice(part.unitPrice)}</p>
                </div>

                {/* Seuil minimum */}
                <div className="rounded-xl bg-gray-50 px-4 py-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Seuil minimum</p>
                  <p className="text-sm font-semibold text-gray-800">{part.minQuantity ?? '—'} unité{part.minQuantity > 1 ? 's' : ''}</p>
                </div>
              </div>

              {/* Valeur totale en stock — highlighted */}
              <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-green-700 mb-0.5">Valeur totale en stock</p>
                  <p className="text-2xl font-bold text-green-800">{formatPrice(part.quantity * part.unitPrice)}</p>
                </div>
                <div className="text-right text-xs text-green-700 opacity-70">
                  <p>{part.quantity} unité{part.quantity > 1 ? 's' : ''}</p>
                  <p>× {formatPrice(part.unitPrice)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="usage">
          <Card>
            <CardHeader>
              <CardTitle>Historique d'utilisation</CardTitle>
              <CardDescription>Utilisation de cette pièce dans les ordres de travail</CardDescription>
            </CardHeader>
            <CardContent>
              {usageHistory.length === 0 ? (
                <div className="text-center py-8">
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-muted">
                    <i className="fas fa-history text-muted-foreground"></i>
                  </div>
                  <h3 className="mt-2 text-sm font-medium text-foreground">Aucune utilisation</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cette pièce n'a pas encore été utilisée dans un ordre de travail.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {usageHistory.map((usage: any) => (
                    <div key={usage.id} className="border rounded-md p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium">Ordre de travail #{usage.workOrderId}</div>
                          <div className="text-sm text-muted-foreground">
                            {usage.workOrder?.title || "Ordre de travail"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{usage.quantity} unité(s)</div>
                          <div className="text-sm text-muted-foreground">
                            {formatPrice(usage.unitPrice * usage.quantity)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="edit">
          {/* PartForm rend deja sa propre Card et son titre "Modifier la pièce":
              pas d'enveloppe supplementaire, sinon titre en double et cartes imbriquees. */}
          <PartForm initialData={part} isEdit={true} partId={partId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
