import { userMessageOf } from "@/lib/api-error";
import { useMemo, useState, useEffect } from "react";
import { PART_REQUIREMENT_STATUS_LABELS } from "@shared/constants/part-requirements";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Package, TrendingUp, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HeaderCard, CardShell, SectionLabel, KpiGrid, KpiTile } from "@/components/design-system";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, formatPrice } from "@/lib/utils";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { purchaseOrderDraft } from "@/lib/form-drafts";

interface Supplier {
  id: number;
  name: string;
  category: string | null;
}

interface ManualOrderLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface PartRequirement {
  id: number;
  partId?: number | null;
  quantityNeeded: number;
  reason: string;
  urgency: string;
  status?: string;
  estimatedCost: string | null;
  partName?: string;
  partReference?: string;
  partSupplier?: string | null;
  partUnitPrice?: string | number | null;
}

interface LowStockPart {
  id: number;
  name: string;
  reference?: string | null;
  quantity?: number | string | null;
  minQuantity?: number | string | null;
  unitPrice?: number | string | null;
  supplier?: string | null;
}

const normalizeText = (value?: string | null) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const parseAmount = (value: unknown): number => {
  const normalized = String(value ?? "0").replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseId = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isSupplierMatch = (left?: string | null, right?: string | null) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

// Libellés de statut: source unique dans `shared/constants/part-requirements.ts`.
const REQUIREMENT_STATUS_LABELS: Record<string, string> =
  PART_REQUIREMENT_STATUS_LABELS;

const REQUIREMENT_STATUS_BADGES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-destructive/15 text-destructive-text",
  ordered: "bg-purple-100 text-purple-800",
  partially_received: "bg-orange-100 text-orange-800",
  received: "bg-success/15 text-success",
  partial: "bg-orange-100 text-orange-800",
  delivered: "bg-success/15 text-success",
  issued: "bg-cyan-100 text-cyan-800",
  fulfilled: "bg-slate-100 text-slate-700",
  cancel_requested: "bg-warning/15 text-warning-text",
  cancelled: "bg-destructive/15 text-destructive-text",
};

const URGENCY_LABELS: Record<string, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
};

const URGENCY_BADGES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-warning/15 text-warning-text",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-destructive/15 text-destructive-text",
};

const formSchema = z.object({
  supplierId: z.number({ required_error: "Sélectionnez un fournisseur" }),
  requirementIds: z.array(z.number()).optional().default([]),
  discountPercentage: z.number().min(0).max(100).optional(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewPurchaseOrderPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedSupplier, setSelectedSupplier] = useState<number | null>(null);
  const [selectedRequirements, setSelectedRequirements] = useState<number[]>([]);
  const [lastPrefillContextKey, setLastPrefillContextKey] = useState<string>("");
  const [discountAutoForSupplier, setDiscountAutoForSupplier] = useState<number | null>(null);
  const [prefilledRequirementId, setPrefilledRequirementId] = useState<number | null>(null);
  const [prefilledSupplierId, setPrefilledSupplierId] = useState<number | null>(null);
  const [prefilledSupplierName, setPrefilledSupplierName] = useState<string>("");
  const [prefillMatchedSupplier, setPrefillMatchedSupplier] = useState<boolean>(false);
  const [requirementOrderQuantities, setRequirementOrderQuantities] = useState<Record<number, number>>({});
  const [manualLines, setManualLines] = useState<ManualOrderLine[]>([]);
  const [newLineDescription, setNewLineDescription] = useState("");
  const [newLineQuantity, setNewLineQuantity] = useState<number>(1);
  const [newLinePrice, setNewLinePrice] = useState<number>(0);
  const canSelectApprovedRequirements = ['admin', 'warehouse', 'secretary'].includes(user?.role || '');

  const prefillParams = useMemo(() => {
    const urlParams = new URLSearchParams(search || "");
    const supplierId = parseId(urlParams.get("supplierId"));
    const requirementId = parseId(urlParams.get("requirementId"));
    const partId = parseId(urlParams.get("partId"));
    const supplierName = (urlParams.get("supplierName") || "").trim();
    return {
      supplierId,
      requirementId,
      partId,
      supplierName,
      hasContext: Boolean(supplierId || requirementId || partId || supplierName),
      contextKey: `${supplierId ?? ""}|${requirementId ?? ""}|${partId ?? ""}|${supplierName}`,
    };
  }, [search]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      urgency: 'medium',
      discountPercentage: 0,
      notes: '',
      requirementIds: [],
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: purchaseOrderDraft.storage as any,
    isEmpty: purchaseOrderDraft.isEmpty as any,
    userId: user?.id,
  });

  // Charger les fournisseurs
  const { data: suppliers = [], isFetched: isSuppliersFetched, isLoading: suppliersLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", { isActive: true }],
  });

  // Charger les suggestions de regroupement
  const { data: groupSuggestions = [], isLoading: groupSuggestionsLoading } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders/group-suggestions", { minRequirements: 1 }],
  });

  const { data: lowStockParts = [], isLoading: lowStockPartsLoading } = useQuery<LowStockPart[]>({
    queryKey: ["/api/parts/low-on-stock"],
  });

  const {
    data: supplierOrders = [],
    isFetched: isSupplierOrdersFetched,
  } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders", { supplierId: selectedSupplier ?? undefined }],
    enabled: !!selectedSupplier,
  });

  const { data: allRequirements = [], isFetched: isAllRequirementsFetched, isLoading: allRequirementsLoading } = useQuery<PartRequirement[]>({
    queryKey: ["/api/part-requirements"],
    // Forcer un rafraîchissement en arrivant sur la page,
    // sinon on peut garder un cache ancien sans la demande juste validée.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const approvedRequirements = useMemo(
    () => allRequirements.filter((req) => req.status === "approved"),
    [allRequirements]
  );

  // Mutation pour créer la commande
  const createOrderMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await apiRequest("POST", "/api/purchase-orders", data);
      return await res.json();
    },
    onSuccess: (order: any) => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Commande créée",
        description: `Commande ${order.orderNumber} créée avec succès`,
      });
      setLocation(`/procurement/orders/${order.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."),
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (data: FormValues) => {
    if (selectedRequirements.length === 0 && manualLines.length === 0) {
      toast({
        title: "Erreur",
        description: "Ajoutez au moins un article ou sélectionnez une demande",
        variant: "destructive",
      });
      return;
    }

    createOrderMutation.mutate({
      ...data,
      requirementIds: canSelectApprovedRequirements ? selectedRequirements : [],
      requirementQuantities: canSelectApprovedRequirements
        ? selectedRequirements.map((requirementId) => {
            const baseRequirement = requirements.find((req) => req.id === requirementId);
            const requestedQty = Math.max(1, Math.floor(Number(baseRequirement?.quantityNeeded || 1)));
            return {
              requirementId,
              quantityOrdered: Math.max(
                requestedQty,
                Math.floor(Number(requirementOrderQuantities[requirementId] || requestedQty))
              ),
            };
          })
        : [],
      manualLines: manualLines.map(line => ({
        description: line.description,
        quantityOrdered: line.quantity,
        unitPrice: line.unitPrice,
      })),
    } as any);
  };

  const toggleRequirement = (id: number) => {
    setSelectedRequirements((prev) => {
      if (prev.includes(id)) {
        setRequirementOrderQuantities((prevQty) => {
          const next = { ...prevQty };
          delete next[id];
          return next;
        });
        return prev.filter((r) => r !== id);
      }

      const selectedReq = allRequirements.find((req) => req.id === id);
      const defaultQty = Math.max(1, Math.floor(Number(selectedReq?.quantityNeeded || 1)));
      setRequirementOrderQuantities((prevQty) => ({ ...prevQty, [id]: defaultQty }));
      return [...prev, id];
    });
  };

  // Obtenir le fournisseur sélectionné avec sa catégorie
  const selectedSupplierData = suppliers.find(s => s.id === selectedSupplier);
  const preselectedRequirement = useMemo(
    () =>
      typeof prefilledRequirementId === "number"
        ? allRequirements.find((req) => req.id === prefilledRequirementId) || null
        : null,
    [allRequirements, prefilledRequirementId]
  );
  const isUsingHistoricalSupplier =
    typeof prefilledSupplierId === "number" && selectedSupplier === prefilledSupplierId;
  const supplierCategory = selectedSupplierData?.category?.toLowerCase() || '';

  // Extraire les demandes approuvées pour le fournisseur sélectionné
  const requirements: PartRequirement[] = selectedSupplier
    ? (canSelectApprovedRequirements ? approvedRequirements : [])
        .filter((req) => isSupplierMatch(req.partSupplier, selectedSupplierData?.name))
    : [];

  // Préremplir via URL: supplierId / requirementId / supplierName (flux depuis "Passer la commande")
  useEffect(() => {
    if (!isSuppliersFetched || !isAllRequirementsFetched) return;

    if (!prefillParams.hasContext) {
      if (lastPrefillContextKey !== "") {
        setLastPrefillContextKey("");
        setPrefilledRequirementId(null);
        setPrefilledSupplierId(null);
        setPrefilledSupplierName("");
        setPrefillMatchedSupplier(false);
        setRequirementOrderQuantities({});
      }
      return;
    }
    if (prefillParams.contextKey === lastPrefillContextKey) return;

    const preselectedRequirement = typeof prefillParams.requirementId === "number"
      ? allRequirements.find((req) => Number(req.id) === prefillParams.requirementId)
      : undefined;

    const fallbackRequirementByPart = typeof prefillParams.partId === "number"
      ? allRequirements.find(
          (req) => Number(req.partId) === prefillParams.partId && req.status === "approved"
        ) || allRequirements.find((req) => Number(req.partId) === prefillParams.partId)
      : undefined;
    const effectiveRequirement = preselectedRequirement || fallbackRequirementByPart;

    const supplierById = typeof prefillParams.supplierId === "number"
      ? suppliers.find((supplier) => supplier.id === prefillParams.supplierId)
      : undefined;
    const supplierNameFromContext = effectiveRequirement?.partSupplier || prefillParams.supplierName || "";
    const supplierByName = suppliers.find(
      (supplier) => isSupplierMatch(supplier.name, supplierNameFromContext)
    );
    const matchedSupplier = supplierById || supplierByName;

    setPrefilledRequirementId(typeof effectiveRequirement?.id === "number" ? effectiveRequirement.id : null);
    setPrefilledSupplierName(supplierNameFromContext || "");

    if (matchedSupplier) {
      setSelectedSupplier(matchedSupplier.id);
      form.setValue("supplierId", matchedSupplier.id);
      setPrefilledSupplierId(matchedSupplier.id);
      setPrefillMatchedSupplier(true);
    } else {
      // Évite de garder un ancien fournisseur sélectionné
      setSelectedSupplier(null);
      form.resetField("supplierId");
      setPrefilledSupplierId(null);
      setPrefillMatchedSupplier(false);
    }

    if (effectiveRequirement && canSelectApprovedRequirements && effectiveRequirement.status === "approved") {
      setSelectedRequirements([effectiveRequirement.id]);
      setRequirementOrderQuantities({
        [effectiveRequirement.id]: Math.max(1, Math.floor(Number(effectiveRequirement.quantityNeeded || 1))),
      });
      if (["low", "medium", "high", "critical"].includes(effectiveRequirement.urgency)) {
        form.setValue("urgency", effectiveRequirement.urgency as FormValues["urgency"]);
      }
    } else {
      setSelectedRequirements([]);
      setRequirementOrderQuantities({});
    }

    setLastPrefillContextKey(prefillParams.contextKey);
  }, [
    prefillParams,
    allRequirements,
    suppliers,
    form,
    isSuppliersFetched,
    isAllRequirementsFetched,
    canSelectApprovedRequirements,
    lastPrefillContextKey,
  ]);

  const additionalSupplierApprovedRequirements = useMemo(
    () =>
      selectedSupplier
        ? approvedRequirements
            .filter((req) => isSupplierMatch(req.partSupplier, selectedSupplierData?.name))
            .filter((req) => !selectedRequirements.includes(req.id))
        : [],
    [approvedRequirements, selectedRequirements, selectedSupplier, selectedSupplierData?.name]
  );

  const nonPendingSupplierRequirements = useMemo(
    () =>
      selectedSupplier
        ? allRequirements
            .filter((req) => isSupplierMatch(req.partSupplier, selectedSupplierData?.name))
            .filter((req) => req.status && req.status !== "pending" && req.status !== "approved")
            .slice(0, 6)
        : [],
    [allRequirements, selectedSupplier, selectedSupplierData?.name]
  );

  const lowStockSuggestions = useMemo(() => {
    if (!selectedSupplier) return [];
    const linkedPartIds = new Set(
      allRequirements
        .filter((req) => isSupplierMatch(req.partSupplier, selectedSupplierData?.name))
        .map((req) => req.partId)
        .filter((id): id is number => typeof id === "number")
    );
    return lowStockParts
      .filter((part) => isSupplierMatch(part.supplier, selectedSupplierData?.name))
      .filter((part) => !linkedPartIds.has(part.id))
      .slice(0, 6);
  }, [allRequirements, lowStockParts, selectedSupplier, selectedSupplierData?.name]);

  const getRequirementOrderedQty = (req: PartRequirement): number => {
    const requestedQty = Math.max(1, Math.floor(Number(req.quantityNeeded || 1)));
    const desiredQty = Math.floor(Number(requirementOrderQuantities[req.id] || requestedQty));
    return Math.max(requestedQty, Number.isFinite(desiredQty) ? desiredQty : requestedQty);
  };

  const getRequirementUnitPrice = (req: PartRequirement): number => {
    const requestedQty = Math.max(1, Math.floor(Number(req.quantityNeeded || 1)));
    const estimatedTotal = parseAmount(req.estimatedCost);
    if (estimatedTotal > 0 && requestedQty > 0) {
      return estimatedTotal / requestedQty;
    }

    const partUnitPrice = parseAmount(req.partUnitPrice);
    if (partUnitPrice > 0) {
      return partUnitPrice;
    }

    return 0;
  };

  const groupSuggestedDiscount = selectedSupplierData
    ? Number(
        (
          groupSuggestions.find(
            (suggestion: any) =>
              suggestion.supplierId === selectedSupplier ||
              isSupplierMatch(suggestion.supplierName, selectedSupplierData?.name)
          )?.recommendedDiscount ?? 0
        )
      )
    : 0;

  const negotiatedDiscountFromHistory =
    supplierOrders.find((order) => parseAmount(order.discountPercentage) > 0)?.discountPercentage ?? 0;

  const suggestedDiscount =
    parseAmount(negotiatedDiscountFromHistory) > 0
      ? parseAmount(negotiatedDiscountFromHistory)
      : groupSuggestedDiscount;

  // Préremplissage remise: applique la remise suggérée à chaque changement de fournisseur
  useEffect(() => {
    if (!selectedSupplier || discountAutoForSupplier === selectedSupplier || !isSupplierOrdersFetched) return;

    form.setValue("discountPercentage", Number.isFinite(suggestedDiscount) ? suggestedDiscount : 0);

    setDiscountAutoForSupplier(selectedSupplier);
  }, [selectedSupplier, suggestedDiscount, form, discountAutoForSupplier, isSupplierOrdersFetched]);

  // Ajouter une ligne manuelle
  const addManualLine = () => {
    if (!newLineDescription.trim() || newLineQuantity <= 0 || newLinePrice <= 0) {
      toast({
        title: "Erreur",
        description: "Remplissez tous les champs correctement",
        variant: "destructive",
      });
      return;
    }

    const newLine: ManualOrderLine = {
      id: Date.now().toString(),
      description: newLineDescription,
      quantity: newLineQuantity,
      unitPrice: newLinePrice,
    };

    setManualLines(prev => [...prev, newLine]);
    setNewLineDescription("");
    setNewLineQuantity(1);
    setNewLinePrice(0);
  };

  const removeManualLine = (id: string) => {
    setManualLines(prev => prev.filter(line => line.id !== id));
  };

  // Calculer le total estimé (demandes + lignes manuelles)
  const requirementsTotal = requirements
    .filter(r => selectedRequirements.includes(r.id))
    .reduce((sum, r) => sum + (getRequirementUnitPrice(r) * getRequirementOrderedQty(r)), 0);

  const manualLinesTotal = manualLines.reduce(
    (sum, line) => sum + (line.quantity * line.unitPrice), 
    0
  );

  const totalEstimated = requirementsTotal + manualLinesTotal;

  const discountPct = form.watch('discountPercentage') || 0;
  const discountAmount = (totalEstimated * discountPct) / 100;
  const totalAfterDiscount = totalEstimated - discountAmount;
  const vatAmount = (totalAfterDiscount * 19.25) / 100;
  const totalTTC = totalAfterDiscount + vatAmount;

  const isInitialLoading = suppliersLoading || groupSuggestionsLoading || allRequirementsLoading || lowStockPartsLoading;

  const addLowStockSuggestionAsManualLine = (part: LowStockPart) => {
    const stock = parseAmount(part.quantity);
    const min = parseAmount(part.minQuantity);
    const recommendedQty = Math.max(1, min - stock);
    const description = `${part.name || "Pièce"}${part.reference ? ` (${part.reference})` : ""}`;
    const alreadyExists = manualLines.some(
      (line) => normalizeText(line.description) === normalizeText(description)
    );

    if (alreadyExists) {
      toast({
        title: "Déjà ajouté",
        description: "Cet article est déjà présent dans les lignes manuelles.",
      });
      return;
    }

    setManualLines((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${part.id}`,
        description,
        quantity: recommendedQty,
        unitPrice: parseAmount(part.unitPrice),
      },
    ]);

    toast({
      title: "Suggestion ajoutée",
      description: `${description} a été ajouté à la commande (Qté suggérée: ${recommendedQty}).`,
    });
  };

  if (isInitialLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-96" />
          </div>
        </CardShell>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Approvisionnement"
        title="Nouvelle commande d'achat"
        subtitle="Créer une commande avec préremplissage intelligent fournisseur + demandes"
        icon={<Package className="h-5 w-5" />}
      >
        <KpiGrid columns={4} withTopBorder={false} className="mt-4">
          <KpiTile
            label="Articles sélectionnés"
            value={selectedRequirements.length}
            subValue="demandes approuvées"
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Total HT"
            value={formatPrice(totalEstimated)}
            subValue="avant remise"
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-success/10 text-success"
          />
          <KpiTile
            label="Remise"
            value={`${discountPct.toFixed(1)}%`}
            subValue={discountPct > 0 ? `- ${formatPrice(discountAmount)}` : "Aucune remise"}
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-warning/10 text-warning-text"
          />
          <KpiTile
            label="Total TTC"
            value={formatPrice(totalTTC)}
            subValue="TVA incluse"
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
            valueClassName="text-lg"
          />
        </KpiGrid>
      </HeaderCard>

      {(preselectedRequirement || prefillParams.hasContext) && (
        <CardShell>
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel className="text-gray-500">Contexte</SectionLabel>
            <h2 className="text-base font-semibold text-gray-900 mt-0.5">Demande ciblée</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Cette commande a été ouverte depuis une demande pièce. Le fournisseur historique est proposé automatiquement.
            </p>
          </div>
          <div className="px-5 py-4">
            <div className="rounded-xl border border-success/30 bg-success/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-success font-medium">Pièce ciblée</p>
                  <p className="text-lg font-semibold text-success">
                    {preselectedRequirement?.partName || (typeof prefillParams.partId === "number" ? `Pièce #${prefillParams.partId}` : "Pièce")}
                    {preselectedRequirement?.partReference ? ` - ${preselectedRequirement.partReference}` : ""}
                  </p>
                  <p className="text-sm text-success mt-1">
                    Demande #{preselectedRequirement?.id ?? prefillParams.requirementId ?? "N/A"} • Qté: {preselectedRequirement?.quantityNeeded ?? "N/A"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                      REQUIREMENT_STATUS_BADGES[preselectedRequirement?.status || ""] || "bg-slate-100 text-slate-700"
                    )}
                  >
                    {REQUIREMENT_STATUS_LABELS[preselectedRequirement?.status || ""] || preselectedRequirement?.status || "Contexte importé"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                      URGENCY_BADGES[preselectedRequirement?.urgency || ""] || "bg-slate-100 text-slate-700"
                    )}
                  >
                    {URGENCY_LABELS[preselectedRequirement?.urgency || ""] || preselectedRequirement?.urgency || "Urgence non définie"}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-success/30 bg-card/80 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-success">Fournisseur historique</p>
                  <p className="font-semibold text-success">{prefilledSupplierName || preselectedRequirement?.partSupplier || "Non défini"}</p>
                </div>
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    isUsingHistoricalSupplier
                      ? "border-success/40 bg-success/15"
                      : "border-warning/30 bg-warning/10"
                  )}
                >
                  <p className="text-xs uppercase tracking-wide text-slate-600">Sélection active</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {isUsingHistoricalSupplier ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <p className="text-sm font-semibold text-success">
                          Fournisseur historique préselectionné
                        </p>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-warning-text" />
                        <p className="text-sm font-semibold text-warning-text">
                          Fournisseur modifié manuellement
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {!prefillMatchedSupplier && (
                <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-text">
                  Aucun fournisseur exact n'a été trouvé automatiquement. Sélectionnez le fournisseur ci-dessous pour continuer.
                </div>
              )}
              {!preselectedRequirement && prefillParams.requirementId && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  La demande #{prefillParams.requirementId} n'a pas été retrouvée (déjà traitée ou hors filtre), mais le contexte fournisseur est conservé.
                </div>
              )}
            </div>
          </div>
        </CardShell>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Sélection fournisseur */}
            <CardShell>
              <div className="px-5 py-4 border-b border-gray-100">
                <SectionLabel className="text-gray-500">Commande</SectionLabel>
                <h2 className="text-base font-semibold text-gray-900 mt-0.5">Informations générales</h2>
                <p className="text-sm text-gray-400 mt-0.5">Sélectionnez le fournisseur et les paramètres</p>
              </div>
              <div className="px-5 py-4 space-y-4">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fournisseur *</FormLabel>
                      <Select
                        value={field.value?.toString()}
                        onValueChange={(value) => {
                          const id = parseInt(value);
                          field.onChange(id);
                          setSelectedSupplier(id);
                          if (id !== selectedSupplier) {
                            setSelectedRequirements([]);
                            setRequirementOrderQuantities({});
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger
                            data-testid="select-supplier"
                            className={cn(
                              isUsingHistoricalSupplier &&
                                "border-success bg-success/10 text-success ring-success/30"
                            )}
                          >
                            <SelectValue placeholder="Sélectionnez un fournisseur" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id.toString()}>
                              {supplier.name}
                              {supplier.category && (
                                <span className="text-xs text-gray-500 ml-2">({supplier.category})</span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isUsingHistoricalSupplier && (
                  <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    Fournisseur historique préselectionné pour accélérer la commande.
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="urgency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Urgence</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-urgency">
                            <SelectValue />
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
                  name="discountPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Remise négociée (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          data-testid="input-discount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Notes internes sur la commande..."
                          data-testid="textarea-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardShell>

            {/* Résumé */}
            <CardShell>
              <div className="px-5 py-4 border-b border-gray-100">
                <SectionLabel className="text-gray-500">Finance</SectionLabel>
                <h2 className="text-base font-semibold text-gray-900 mt-0.5">Résumé de la commande</h2>
                <p className="text-sm text-gray-400 mt-0.5">Montants estimés</p>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Articles sélectionnés:</span>
                    <span className="font-medium" data-testid="selected-count">
                      {selectedRequirements.length}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Total HT:</span>
                    <span className="font-medium">
                      {formatPrice(totalEstimated)}
                    </span>
                  </div>

                  {discountPct > 0 && (
                    <div className="flex justify-between text-success dark:text-success">
                      <span>Remise ({discountPct.toFixed(1)}%):</span>
                      <span className="font-medium">
                        -{formatPrice(discountAmount)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">TVA (19.25%):</span>
                    <span className="font-medium">
                      {formatPrice(vatAmount)}
                    </span>
                  </div>

                  <div className="border-t pt-2 mt-2 flex justify-between text-lg">
                    <span className="font-semibold">Total TTC:</span>
                    <span className="font-bold" data-testid="total-ttc">
                      {formatPrice(totalTTC)}
                    </span>
                  </div>
                </div>

                {discountPct > 0 && (
                  <div className="bg-success/10 dark:bg-green-900/20 p-3 rounded-lg">
                    <div className="flex items-center gap-2 text-success dark:text-success">
                      <TrendingUp className="h-4 w-4" />
                      <span className="font-medium">
                        Économie: {formatPrice(discountAmount)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardShell>
          </div>

          {/* Liste des demandes */}
          {selectedSupplier && (
            <CardShell>
              <div className="px-5 py-4 border-b border-gray-100">
                <SectionLabel className="text-gray-500">Demandes</SectionLabel>
                <h2 className="text-base font-semibold text-gray-900 mt-0.5">Demandes disponibles</h2>
                <p className="text-sm text-gray-400 mt-0.5">Sélectionnez les demandes à inclure dans cette commande</p>
              </div>
              <div className="px-5 py-4">
                {!canSelectApprovedRequirements && (
                  <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
                    Ce profil peut créer des commandes, mais ne convertit pas directement les demandes pièces atelier.
                  </div>
                )}
                {requirements.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {canSelectApprovedRequirements
                      ? "Aucune demande approuvée disponible pour ce fournisseur"
                      : "Aucune demande affichée pour ce profil"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {requirements.map((req) => (
                      <div
                        key={req.id}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                          selectedRequirements.includes(req.id)
                            ? 'bg-blue-50 border-blue-500'
                            : 'hover:bg-gray-50'
                        }`}
                        onClick={() => toggleRequirement(req.id)}
                        data-testid={`requirement-${req.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Package className="h-4 w-4 text-gray-400" />
                              <span className="font-medium">{req.partName || "Article"}</span>
                              <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                                {req.urgency}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600">{req.reason}</p>
                            <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                              <span className="text-gray-600">Demandée: <span className="font-semibold text-gray-800">{req.quantityNeeded}</span></span>
                              <span className="text-gray-600">Prix unit.: <span className="font-semibold text-gray-800">{formatPrice(getRequirementUnitPrice(req))}</span></span>
                              <span className="text-gray-600">Total ligne: <span className="font-semibold text-gray-900">{formatPrice(getRequirementUnitPrice(req) * getRequirementOrderedQty(req))}</span></span>
                            </div>
                            {selectedRequirements.includes(req.id) && (
                              <div className="mt-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                                <Label className="text-xs text-gray-500">Qté commandée</Label>
                                <Input
                                  type="number"
                                  min={Math.max(1, req.quantityNeeded)}
                                  value={getRequirementOrderedQty(req)}
                                  onChange={(event) => {
                                    const requestedQty = Math.max(1, Math.floor(Number(req.quantityNeeded || 1)));
                                    const value = Math.floor(Number(event.target.value || requestedQty));
                                    const safeQty = Math.max(requestedQty, Number.isFinite(value) ? value : requestedQty);
                                    setRequirementOrderQuantities((prevQty) => ({
                                      ...prevQty,
                                      [req.id]: safeQty,
                                    }));
                                  }}
                                  className="h-8 w-28"
                                  data-testid={`input-requirement-qty-${req.id}`}
                                />
                              </div>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedRequirements.includes(req.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleRequirement(req.id)}
                            className="mt-1"
                            data-testid={`checkbox-requirement-${req.id}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(additionalSupplierApprovedRequirements.length > 0 || nonPendingSupplierRequirements.length > 0 || lowStockSuggestions.length > 0) && (
                  <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                    <div className="flex items-center gap-2 text-blue-800">
                      <Sparkles className="h-4 w-4" />
                      <p className="text-sm font-semibold">Suggestions du même fournisseur</p>
                    </div>
                    <p className="mt-1 text-xs text-blue-700">
                      Regroupez les besoins pour éviter des micro-commandes successives.
                    </p>

                    {additionalSupplierApprovedRequirements.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs uppercase tracking-wide text-blue-700 mb-2">Demandes approuvées prêtes à ajouter</p>
                        <div className="space-y-2">
                          {additionalSupplierApprovedRequirements.slice(0, 5).map((req) => (
                            <div
                              key={`suggest-approved-${req.id}`}
                              className="flex items-center justify-between rounded-lg border border-blue-200 bg-card px-3 py-2"
                            >
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {req.partName || "Article"} {req.partReference ? `(${req.partReference})` : ""}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Demande #{req.id} • Qté {req.quantityNeeded} • {URGENCY_LABELS[req.urgency] || req.urgency}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => toggleRequirement(req.id)}
                              >
                                Ajouter
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {lowStockSuggestions.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs uppercase tracking-wide text-blue-700 mb-2">Stock bas / rupture du même fournisseur</p>
                        <div className="space-y-2">
                          {lowStockSuggestions.map((part) => {
                            const quantity = parseAmount(part.quantity);
                            const minQuantity = parseAmount(part.minQuantity);
                            const recommendedQty = Math.max(1, minQuantity - quantity);
                            return (
                              <div
                                key={`suggest-low-stock-${part.id}`}
                                className="flex items-center justify-between rounded-lg border border-blue-200 bg-card px-3 py-2"
                              >
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {part.name} {part.reference ? `(${part.reference})` : ""}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    Stock {quantity} / Min {minQuantity} • Suggestion: +{recommendedQty}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addLowStockSuggestionAsManualLine(part)}
                                >
                                  Ajouter en manuel
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {nonPendingSupplierRequirements.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs uppercase tracking-wide text-blue-700 mb-2">Autres demandes en cours (information)</p>
                        <div className="flex flex-wrap gap-2">
                          {nonPendingSupplierRequirements.map((req) => (
                            <span
                              key={`suggest-in-progress-${req.id}`}
                              className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                                REQUIREMENT_STATUS_BADGES[req.status || ""] || "bg-slate-100 text-slate-700"
                              )}
                            >
                              #{req.id} {REQUIREMENT_STATUS_LABELS[req.status || ""] || req.status}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardShell>
          )}

          {/* Ajout manuel d'articles */}
          {selectedSupplier && (
            <CardShell>
              <div className="px-5 py-4 border-b border-gray-100">
                <SectionLabel className="text-gray-500">Saisie libre</SectionLabel>
                <h2 className="text-base font-semibold text-gray-900 mt-0.5">Ajouter des articles manuellement</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {supplierCategory.includes('pièce') || supplierCategory.includes('piece') 
                    ? "Ajoutez des pièces détachées"
                    : supplierCategory.includes('carburant') || supplierCategory.includes('fuel')
                    ? "Ajoutez du carburant"
                    : supplierCategory.includes('télécom') || supplierCategory.includes('internet')
                    ? "Ajoutez des forfaits/services"
                    : "Ajoutez des articles"}
                </p>
              </div>
              <div className="px-5 py-4 space-y-4">
                {/* Formulaire d'ajout */}
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <Label>
                      {supplierCategory.includes('pièce') || supplierCategory.includes('piece')
                        ? "Nom de la pièce / Référence"
                        : supplierCategory.includes('carburant') || supplierCategory.includes('fuel')
                        ? "Type de carburant (Diesel, Essence, etc.)"
                        : supplierCategory.includes('télécom') || supplierCategory.includes('internet')
                        ? "Forfait / Service"
                        : "Description"}
                    </Label>
                    <Input
                      value={newLineDescription}
                      onChange={(e) => setNewLineDescription(e.target.value)}
                      placeholder={
                        supplierCategory.includes('carburant') 
                          ? "Ex: Diesel, Essence 95" 
                          : supplierCategory.includes('télécom')
                          ? "Ex: Forfait 100Go, Ligne professionnelle"
                          : "Ex: Filtre à huile, Courroie"
                      }
                      data-testid="input-manual-description"
                    />
                  </div>
                  <div>
                    <Label>
                      {supplierCategory.includes('carburant') || supplierCategory.includes('fuel')
                        ? "Volume (Litres)"
                        : "Quantité"}
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={newLineQuantity}
                      onChange={(e) => setNewLineQuantity(parseInt(e.target.value) || 1)}
                      data-testid="input-manual-quantity"
                    />
                  </div>
                  <div>
                    <Label>Prix Unitaire (FCFA)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={newLinePrice}
                      onChange={(e) => setNewLinePrice(parseFloat(e.target.value) || 0)}
                      data-testid="input-manual-price"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={addManualLine}
                  className="w-full"
                  data-testid="button-add-manual-line"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Ajouter cet article
                </Button>

                {/* Liste des articles ajoutés */}
                {manualLines.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-3">Articles ajoutés ({manualLines.length})</h4>
                    <div className="space-y-2">
                      {manualLines.map((line) => (
                        <div
                          key={line.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                          data-testid={`manual-line-${line.id}`}
                        >
                          <div className="flex-1">
                            <div className="font-medium">{line.description}</div>
                            <div className="text-sm text-gray-600">
                              {line.quantity} × {formatPrice(line.unitPrice)} = {' '}
                              <span className="font-medium">
                                {formatPrice(line.quantity * line.unitPrice)}
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeManualLine(line.id)}
                            data-testid={`button-remove-${line.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive-text" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardShell>
          )}

          {/* Actions */}
          <CardShell>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Vérifiez les montants et les lignes avant validation de la commande.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/procurement/orders")}
                  data-testid="button-cancel"
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={createOrderMutation.isPending || (selectedRequirements.length === 0 && manualLines.length === 0)}
                  data-testid="button-submit"
                >
                  {createOrderMutation.isPending ? "Création..." : "Créer la commande"}
                </Button>
              </div>
            </div>
          </CardShell>
        </form>
      </Form>
    </div>
  );
}
