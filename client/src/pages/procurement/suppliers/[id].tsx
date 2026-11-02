import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { canRoleEvaluateSupplierCategory } from "@shared/constants/supplier-categories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Star,
  Package,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Edit,
  Power,
  PowerOff,
  ShoppingCart,
  Building2,
  Info,
  BarChart3,
  Clock,
  ArrowLeft,
  HelpCircle,
} from "lucide-react";
import type { Supplier } from "@shared/schema";
import {
  SUPPLIER_RATING_FIELDS,
  getSupplierRatingFieldPermissions,
  type SupplierRatingField,
} from "@shared/constants/supplier-ratings";
import { apiRequest } from "@/lib/queryClient";

type AppRole =
  | "admin"
  | "workshop_manager"
  | "technician"
  | "user"
  | "secretary"
  | "warehouse"
  | "logistics"
  | "client";

type RatingField = SupplierRatingField;
type RatingDraft = Record<RatingField, number>;
type SupplierWithCreator = Supplier & { createdByName?: string | null };

function RatingFieldHelp({
  field,
  canEdit,
}: {
  field: RatingField;
  canEdit: boolean;
}) {
  const meta = SUPPLIER_RATING_FIELDS.find((item) => item.field === field);
  if (!meta) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/30"
            aria-label={`Qui peut noter : ${meta.label}`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
          <p>{meta.description}</p>
          <p className="mt-2 font-medium text-foreground">Peut noter : {meta.editorsLabel}</p>
          <p className={`mt-1 ${canEdit ? "text-green-700" : "text-muted-foreground"}`}>
            {canEdit ? "Vous pouvez modifier ce critère." : "Lecture seule pour votre profil."}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  administrateur: "admin",
  workshop_manager: "workshop_manager",
  gestionnaire_atelier: "workshop_manager",
  "gestionnaire d'atelier": "workshop_manager",
  technician: "technician",
  technicien: "technician",
  secretary: "secretary",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logistics: "logistics",
  logisticien: "logistics",
  warehouse: "warehouse",
  magasinier: "warehouse",
  client: "client",
  user: "user",
};

const normalizeRole = (role: string | undefined): AppRole => {
  const normalized = (role || "").trim().toLowerCase();
  return ROLE_ALIASES[normalized] || "user";
};

const getRatingFieldPermissions = (role: AppRole): Record<RatingField, boolean> =>
  getSupplierRatingFieldPermissions(role);

const clampRating = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(5, value));
};

export default function SupplierDetailsPage() {
  const { user } = useAuth();
  const [, params] = useRoute("/procurement/suppliers/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const supplierId = params?.id ? parseInt(params.id) : null;
  const normalizedRole = useMemo(() => normalizeRole(user?.role), [user?.role]);

  // Vérifier si l'utilisateur a les droits d'écriture (admin, secretary ou logistics)
  const hasWritePermission =
    normalizedRole === "admin" || normalizedRole === "secretary" || normalizedRole === "logistics";

  // Vérifier si l'utilisateur peut créer des commandes
  const canCreateOrder = ["admin", "warehouse", "secretary", "logistics"].includes(normalizedRole);
  const ratingFieldPermissions = useMemo(
    () => getRatingFieldPermissions(normalizedRole),
    [normalizedRole]
  );
  const canAutoCalculateRatings = normalizedRole === "admin";
  
  const canEvaluateSupplier = (category: string | null | undefined) =>
    canRoleEvaluateSupplierCategory(normalizedRole, category);

  const { data: supplierData, isLoading } = useQuery<{
    supplier: SupplierWithCreator;
    statistics: {
      totalInvoices: number;
      totalAmount: number;
      totalPaid: number;
      totalPending: number;
      partsCount: number;
    };
  }>({
    queryKey: [`/api/suppliers/${supplierId}`],
    enabled: !!supplierId,
  });

  const { data: performance } = useQuery<{
    supplier: Supplier;
    ratings: {
      quality: number;
      reliability: number;
      priceCompetitiveness: number;
      overall: number;
    };
    deliveryMetrics: {
      onTimeDeliveries: number;
      lateDeliveries: number;
      onTimePercentage: number;
    };
    financialMetrics: {
      totalSpent: number;
      averageInvoiceAmount: number;
      pendingAmount: number;
    };
  }>({
    queryKey: [`/api/suppliers/${supplierId}/performance`],
    enabled: !!supplierId,
  });

  const [ratingDraft, setRatingDraft] = useState<RatingDraft>({
    qualityRating: 0,
    reliabilityRating: 0,
    priceCompetitiveness: 0,
  });

  useEffect(() => {
    if (!performance) {
      return;
    }

    setRatingDraft({
      qualityRating: clampRating(performance.ratings.quality),
      reliabilityRating: clampRating(performance.ratings.reliability),
      priceCompetitiveness: clampRating(performance.ratings.priceCompetitiveness),
    });
  }, [
    performance?.ratings.quality,
    performance?.ratings.reliability,
    performance?.ratings.priceCompetitiveness,
  ]);

  const canEditAnyRating = useMemo(
    () => Object.values(ratingFieldPermissions).some(Boolean),
    [ratingFieldPermissions]
  );

  const hasRatingChanges = useMemo(() => {
    if (!performance) {
      return false;
    }

    const currentValues: RatingDraft = {
      qualityRating: clampRating(performance.ratings.quality),
      reliabilityRating: clampRating(performance.ratings.reliability),
      priceCompetitiveness: clampRating(performance.ratings.priceCompetitiveness),
    };

    return (Object.keys(ratingFieldPermissions) as RatingField[]).some(
      (field) =>
        ratingFieldPermissions[field] &&
        Math.abs(currentValues[field] - ratingDraft[field]) > 0.001
    );
  }, [performance, ratingDraft, ratingFieldPermissions]);

  const updateRatingValue = (field: RatingField, value: number) => {
    setRatingDraft((prev) => ({
      ...prev,
      [field]: clampRating(value),
    }));
  };

  const resetRatings = () => {
    if (!performance) {
      return;
    }

    setRatingDraft({
      qualityRating: clampRating(performance.ratings.quality),
      reliabilityRating: clampRating(performance.ratings.reliability),
      priceCompetitiveness: clampRating(performance.ratings.priceCompetitiveness),
    });
  };

  const updateRatingsMutation = useMutation({
    mutationFn: async () => {
      if (!performance) {
        throw new Error("Aucune donnée de performance à mettre à jour");
      }

      const currentValues: RatingDraft = {
        qualityRating: clampRating(performance.ratings.quality),
        reliabilityRating: clampRating(performance.ratings.reliability),
        priceCompetitiveness: clampRating(performance.ratings.priceCompetitiveness),
      };

      const payload: Partial<RatingDraft> = {};

      if (
        ratingFieldPermissions.qualityRating &&
        Math.abs(ratingDraft.qualityRating - currentValues.qualityRating) > 0.001
      ) {
        payload.qualityRating = clampRating(ratingDraft.qualityRating);
      }
      if (
        ratingFieldPermissions.reliabilityRating &&
        Math.abs(ratingDraft.reliabilityRating - currentValues.reliabilityRating) > 0.001
      ) {
        payload.reliabilityRating = clampRating(ratingDraft.reliabilityRating);
      }
      if (
        ratingFieldPermissions.priceCompetitiveness &&
        Math.abs(ratingDraft.priceCompetitiveness - currentValues.priceCompetitiveness) > 0.001
      ) {
        payload.priceCompetitiveness = clampRating(ratingDraft.priceCompetitiveness);
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("Aucune modification de note détectée");
      }

      const response = await apiRequest("PATCH", `/api/suppliers/${supplierId}/rating`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}/performance`] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers/top"] });
      toast({
        title: "Évaluations mises à jour",
        description: "Les notes du fournisseur ont été enregistrées.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de mettre à jour les notes.",
        variant: "destructive",
      });
    },
  });

  const calculateRatingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/suppliers/${supplierId}/calculate-ratings`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}/performance`] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers/top"] });
      toast({
        title: "Calcul automatique terminé",
        description: "Les notes ont été recalculées à partir des données disponibles.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de recalculer les notes.",
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const endpoint = isActive
        ? `/api/suppliers/${supplierId}/reactivate`
        : `/api/suppliers/${supplierId}`;
      const method = isActive ? "PATCH" : "DELETE";
      
      return await apiRequest(method, endpoint);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({
        title: "Statut mis à jour",
        description: "Le statut du fournisseur a été modifié avec succès.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Une erreur est survenue.",
        variant: "destructive",
      });
    },
  });

  const renderRatingStars = (rating: number) => {
    const stars: React.ReactNode[] = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`h-5 w-5 ${
            i <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300 dark:text-gray-600"
          }`}
        />
      );
    }
    return <div className="flex gap-0.5">{stars}</div>;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-36 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
        <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (!supplierData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
          <Building2 className="w-6 h-6 text-gray-300" />
        </div>
        <p className="text-sm text-gray-400">Fournisseur non trouvé</p>
      </div>
    );
  }

  const { supplier, statistics } = supplierData;
  const canEvaluateCurrentSupplier = canEvaluateSupplier(supplier.category);
  const performanceRatingRows: Array<{ field: RatingField; value: number }> = performance
    ? [
        { field: "qualityRating", value: performance.ratings.quality },
        { field: "reliabilityRating", value: performance.ratings.reliability },
        { field: "priceCompetitiveness", value: performance.ratings.priceCompetitiveness },
      ]
    : [];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">

          {/* Actions */}
          <div className="flex items-start justify-between mb-4">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 text-muted-foreground"
              onClick={() => setLocation("/procurement/suppliers")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Fournisseurs
            </Button>
            <div className="flex items-center gap-2">
              {canCreateOrder && (
                <Button
                  size="sm"
                  onClick={() => setLocation(`/procurement/orders/new?supplierId=${supplierId}`)}
                  data-testid="button-create-order"
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Commander
                </Button>
              )}
              {hasWritePermission && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation(`/procurement/suppliers/${supplierId}/edit`)}
                    data-testid="button-edit"
                    className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Modifier
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActiveMutation.mutate(!supplier.isActive)}
                    disabled={toggleActiveMutation.isPending}
                    data-testid="button-toggle-active"
                    className={supplier.isActive
                      ? "border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
                      : "border-green-200 text-green-700 hover:bg-green-50 gap-1.5"}
                  >
                    {supplier.isActive
                      ? <><PowerOff className="h-3.5 w-3.5" />Désactiver</>
                      : <><Power className="h-3.5 w-3.5" />Réactiver</>}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Title row */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Approvisionnement</span>
                {supplier.isActive
                  ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Actif</span>
                  : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactif</span>}
                {supplier.category && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50">{supplier.category}</span>
                )}
              </div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{supplier.name}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Créé par {supplier.createdByName || (supplier.createdBy ? `Utilisateur #${supplier.createdBy}` : "Système")}
                {" · "}Mis à jour le {new Date(supplier.updatedAt).toLocaleDateString("fr-FR")}
              </p>
            </div>
            {performance && (
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Note globale</p>
                <div className="flex items-center gap-1.5 justify-end">
                  {renderRatingStars(Math.round(performance.ratings.overall))}
                  <span className="text-xl font-bold text-gray-800">{performance.ratings.overall.toFixed(1)}</span>
                </div>
              </div>
            )}
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              {
                icon: <DollarSign className="h-4 w-4 text-green-600" />,
                iconBg: "bg-green-50",
                label: "Total dépensé",
                value: `${(statistics.totalPaid / 1000000).toFixed(1)}M`,
                sub: `${statistics.totalInvoices} facture${statistics.totalInvoices > 1 ? "s" : ""}`,
              },
              {
                icon: <FileText className="h-4 w-4 text-orange-500" />,
                iconBg: "bg-orange-50",
                label: "En attente",
                value: `${(statistics.totalPending / 1000000).toFixed(1)}M`,
                sub: "à régler",
              },
              {
                icon: <Package className="h-4 w-4 text-blue-500" />,
                iconBg: "bg-blue-50",
                label: "Pièces fournies",
                value: String(statistics.partsCount),
                sub: "références",
              },
              {
                icon: <TrendingUp className="h-4 w-4 text-purple-500" />,
                iconBg: "bg-purple-50",
                label: "Facture moyenne",
                value: performance ? `${(performance.financialMetrics.averageInvoiceAmount / 1000).toFixed(0)}K` : "–",
                sub: "par commande",
              },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
                <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                  {kpi.icon}
                </div>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium text-gray-500">{kpi.label}</p>
                  <p className="text-xl font-bold text-gray-800 leading-none mt-1">{kpi.value}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{kpi.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="info" className="space-y-5">
        <TabsList className="w-full rounded-xl bg-gray-100/70 p-1 h-auto gap-1 flex">
          <TabsTrigger value="info" data-testid="tab-info"
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-green-700 transition-all">
            <Info className="h-3.5 w-3.5 shrink-0" /><span>Informations</span>
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance"
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-green-700 transition-all">
            <BarChart3 className="h-3.5 w-3.5 shrink-0" /><span>Performances</span>
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-green-700 transition-all">
            <Clock className="h-3.5 w-3.5 shrink-0" /><span>Historique</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Informations ── */}
        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                    <Info className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-3">
                {[
                  { label: "Nom du contact", value: supplier.contactName },
                  { label: "Email", value: supplier.email },
                  { label: "Téléphone", value: supplier.phone },
                  { label: "Adresse", value: supplier.address },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-3">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide w-28 shrink-0 pt-0.5">{label}</span>
                    <span className="text-[13px] text-gray-700 whitespace-pre-line">{value || "–"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border border-gray-100 shadow-sm">
              <div className="h-0.5 bg-gradient-to-r from-blue-500 to-indigo-400" />
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                  <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  Informations légales
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-3">
                {[
                  { label: "SIRET/SIREN", value: supplier.siret },
                  { label: "Numéro TVA", value: supplier.vatNumber },
                  { label: "Délai paiement", value: supplier.paymentTerms ? `${supplier.paymentTerms} jours` : null },
                  { label: "Livraison", value: supplier.deliveryTerms },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-3">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide w-28 shrink-0 pt-0.5">{label}</span>
                    <span className="text-[13px] text-gray-700">{value || "–"}</span>
                  </div>
                ))}
                {supplier.notes && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-[13px] text-gray-700 whitespace-pre-line">{supplier.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Performances ── */}
        <TabsContent value="performance" className="space-y-4">
          {performance && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Évaluations */}
                <Card className="overflow-hidden border border-gray-100 shadow-sm">
                  <div className="h-0.5 bg-gradient-to-r from-amber-500 to-yellow-400" />
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                      <div className="w-6 h-6 rounded-md bg-amber-50 flex items-center justify-center">
                        <Star className="w-3.5 h-3.5 text-amber-500" />
                      </div>
                      Évaluations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 space-y-3">
                    {performanceRatingRows.map(({ field, value }) => {
                      const meta = SUPPLIER_RATING_FIELDS.find((item) => item.field === field);
                      return (
                      <div key={field} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[12px] text-gray-600 truncate">{meta?.label}</span>
                          <RatingFieldHelp field={field} canEdit={ratingFieldPermissions[field]} />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {renderRatingStars(Math.round(value))}
                          <span className="text-[11px] text-gray-400 w-6 text-right">{value.toFixed(1)}</span>
                        </div>
                      </div>
                    );})}
                  </CardContent>
                </Card>

                {/* Métriques livraison */}
                <Card className="overflow-hidden border border-gray-100 shadow-sm">
                  <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                      <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                        <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                      </div>
                      Livraisons
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-gray-600">À temps</span>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-[13px] font-semibold text-green-700">{performance.deliveryMetrics.onTimeDeliveries}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-gray-600">En retard</span>
                      <div className="flex items-center gap-1.5">
                        <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                        <span className="text-[13px] font-semibold text-red-600">{performance.deliveryMetrics.lateDeliveries}</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12px] text-gray-600">Taux de ponctualité</span>
                        <span className="text-[13px] font-bold text-green-700">{performance.deliveryMetrics.onTimePercentage}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
                          style={{ width: `${performance.deliveryMetrics.onTimePercentage}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Saisie des notes */}
              {canEvaluateCurrentSupplier ? (
                <Card className="overflow-hidden border border-gray-100 shadow-sm">
                  <div className="h-0.5 bg-gradient-to-r from-violet-500 to-purple-400" />
                  <CardHeader className="pb-2 pt-4 px-5">
                    <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                      <div className="w-6 h-6 rounded-md bg-violet-50 flex items-center justify-center">
                        <Edit className="w-3.5 h-3.5 text-violet-500" />
                      </div>
                      Saisie des évaluations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4">
                    <p className="text-[12px] text-gray-400 mb-4">
                      Chaque critère est noté par un métier différent. Survolez{" "}
                      <HelpCircle className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden /> pour voir qui
                      peut modifier quoi.
                    </p>
                    <div className="space-y-5">
                      {SUPPLIER_RATING_FIELDS.map((item) => {
                        const isEditable = ratingFieldPermissions[item.field];
                        const draftValue = ratingDraft[item.field];
                        return (
                          <div key={item.field} className={`rounded-xl p-3 border ${isEditable ? 'border-violet-100 bg-violet-50/40' : 'border-gray-100 bg-gray-50/50'}`}>
                            <div className="flex items-center justify-between text-[12px] mb-2 gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-medium text-gray-700">{item.label}</span>
                                <RatingFieldHelp field={item.field} canEdit={isEditable} />
                              </div>
                              <span className={`font-bold shrink-0 ${isEditable ? "text-violet-600" : "text-gray-400"}`}>
                                {draftValue.toFixed(1)} / 5
                              </span>
                            </div>
                            <Slider
                              min={0}
                              max={5}
                              step={0.1}
                              value={[draftValue]}
                              onValueChange={(values) => updateRatingValue(item.field, values[0] ?? 0)}
                              disabled={!isEditable || updateRatingsMutation.isPending}
                            />
                            <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400">
                              <span>{item.roleHint}</span>
                              {!isEditable ? <span>Lecture seule</span> : <span className="text-violet-600 font-medium">Modifiable</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
                      <Button variant="outline" size="sm" onClick={resetRatings}
                        disabled={!canEditAnyRating || updateRatingsMutation.isPending}
                        data-testid="button-reset-ratings" className="text-[12px]">
                        Réinitialiser
                      </Button>
                      {canAutoCalculateRatings && (
                        <Button variant="outline" size="sm"
                          onClick={() => calculateRatingsMutation.mutate()}
                          disabled={calculateRatingsMutation.isPending}
                          data-testid="button-calculate-ratings" className="text-[12px]">
                          {calculateRatingsMutation.isPending ? "Calcul..." : "Calcul automatique"}
                        </Button>
                      )}
                      <Button size="sm"
                        onClick={() => updateRatingsMutation.mutate()}
                        disabled={!canEditAnyRating || !hasRatingChanges || updateRatingsMutation.isPending}
                        data-testid="button-save-ratings"
                        className="bg-green-600 hover:bg-green-700 text-white text-[12px]">
                        {updateRatingsMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden border border-gray-100 shadow-sm">
                  <CardContent className="px-5 py-6">
                    <p className="text-[12px] text-gray-400 text-center">
                      Vous n'avez pas les droits d'évaluation pour la catégorie de ce fournisseur.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Historique ── */}
        <TabsContent value="history">
          <Card className="overflow-hidden border border-gray-100 shadow-sm">
            <div className="h-0.5 bg-gradient-to-r from-gray-300 to-gray-200" />
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
                <div className="w-6 h-6 rounded-md bg-gray-50 flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                </div>
                Historique des commandes et factures
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-6">
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6 text-gray-300" />
                </div>
                <p className="text-sm text-gray-400">L'historique détaillé sera disponible prochainement</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
