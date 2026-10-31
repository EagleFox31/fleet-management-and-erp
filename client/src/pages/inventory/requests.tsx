import React, { useState } from "react";
import { PartReceptionLine } from "@/components/inventory/part-reception-line";
import { getPartRequirementStatusLabel } from "@shared/constants/part-requirements";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  Clock,
  Package,
  AlertCircle,
  Eye,
  Truck,
  X,
  ArrowRight,
  Info,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  ShoppingCart,
  PackageCheck,
  HelpCircle,
  Wrench,
  AlertTriangle,
  User,
  Calendar,
  Banknote,
  StickyNote,
  MessageSquare,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { formatCurrency } from "@/lib/utils";

interface PartRequirement {
  id: number;
  receivedByName?: string | null;
  receivedAt?: string | null;
  partId: number;
  partName: string;
  partReference: string;
  partSupplier?: string;
  quantityNeeded: number;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  status:
    | 'pending'
    | 'approved'
    | 'ordered'
    | 'partially_received'
    | 'received'
    | 'delivered'
    | 'rejected'
    | 'cancel_requested'
    | 'cancelled'
    | 'issued'
    | 'fulfilled'
    | 'partial';
  requestedBy: number;
  requesterName: string;
  requesterRole?: string;
  estimatedCost?: number | string | null;
  partUnitPrice?: number | string | null;
  supplierNotes?: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  linkedPurchaseOrderId?: number | null;
  linkedPurchaseOrderStatus?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface AwaitingPartsWorkOrder {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  vehicle?: {
    registrationNumber: string;
    brand: string;
    model: string;
  };
  technician?: {
    name: string;
  };
  pendingParts: {
    requestId: number;
    partId: number;
    partName: string;
    partReference: string;
    quantityNeeded: number;
    status: string;
    urgency: string;
    expectedDeliveryDate?: string;
  }[];
  pendingPartsCount: number;
  createdAt: string;
}

export default function PartRequestsIndex() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<PartRequirement | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updateAction, setUpdateAction] = useState<"order_override" | "receive" | null>(null);
  const [showProcessHelp, setShowProcessHelp] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
  
  const isRequestApprover =
    user?.role === 'workshop_manager' ||
    user?.role === 'admin' ||
    user?.role === 'secretary';
  const isSupplyOperator = ['warehouse', 'secretary', 'admin'].includes(user?.role || "");
  const currentUserId = typeof user?.id === "number" ? user.id : undefined;
  const currentUserRole = user?.role;

  const canValidatePendingRequest = (request: PartRequirement) => {
    if (request.status !== "pending" || !currentUserRole) return false;

    const isRequester =
      typeof currentUserId === "number" && request.requestedBy === currentUserId;
    if (isRequester) return false;

    // Règle stricte: une demande créée par un chef d'atelier
    // doit être validée/rejetée uniquement par la secrétaire.
    if (request.requesterRole === "workshop_manager") {
      return currentUserRole === "secretary";
    }

    return ["workshop_manager", "secretary", "admin"].includes(currentUserRole);
  };

  const getOrderStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: "Brouillon",
      sent: "Envoyé",
      confirmed: "Confirmé",
      partial: "Partiel",
      delivered: "Livré",
      closed: "Clôturé",
      cancelled: "Annulé",
    };
    return labels[status] || status;
  };

  const getRequestActionPermissions = (request: PartRequirement) => {
    const isLinkedToPurchaseOrder = typeof request.linkedPurchaseOrderId === "number";
    const orderReadyForReception = ["partial", "delivered", "completed"].includes(
      request.linkedPurchaseOrderStatus || ""
    );
    const canApproveReject = canValidatePendingRequest(request);
    const canOrder = request.status === "approved" && isSupplyOperator;
    const canReceive =
      request.status === "ordered" &&
      isSupplyOperator &&
      (!isLinkedToPurchaseOrder || orderReadyForReception);
    const canTrackOrder =
      request.status === "ordered" &&
      isSupplyOperator &&
      isLinkedToPurchaseOrder &&
      !orderReadyForReception;
    const canViewLinkedOrder = isLinkedToPurchaseOrder;

    return {
      canApproveReject,
      canOrder,
      canReceive,
      canTrackOrder,
      canViewLinkedOrder,
      needsMyAction: canApproveReject || canOrder || canReceive,
    };
  };

  // États du formulaire de mise à jour
  const [estimatedCost, setEstimatedCost] = useState<string>("");
  const [supplierNotes, setSupplierNotes] = useState<string>("");
  const [emergencyOverrideReason, setEmergencyOverrideReason] = useState<string>("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [actualDeliveryDate, setActualDeliveryDate] = useState<string>("");

  const getProcurementPrefillUrl = (request: PartRequirement) => {
    const params = new URLSearchParams({
      requirementId: String(request.id),
      partId: String(request.partId),
      source: "inventory_requests",
    });

    if (request.partSupplier?.trim()) {
      params.set("supplierName", request.partSupplier.trim());
    }

    return `/procurement/orders/new?${params.toString()}`;
  };

  const getTodayLocalDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Récupérer toutes les demandes de pièces
  const { data: requests = [], isLoading } = useQuery<PartRequirement[]>({
    queryKey: ["/api/part-requirements"],
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  // Récupérer les OT en attente de pièces (pour le magasinier)
  const { data: awaitingPartsData, isLoading: isLoadingAwaitingParts } = useQuery<{
    workOrders: AwaitingPartsWorkOrder[];
    total: number;
  }>({
    queryKey: ["/api/work-orders/awaiting-parts"],
    enabled: isSupplyOperator, // Magasinier + Secrétaire + Admin (backup)
    refetchInterval: isSupplyOperator ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  const awaitingPartsWorkOrders = awaitingPartsData?.workOrders || [];

  // Filtrer les demandes
  const filteredRequests = requests.filter((request: PartRequirement) => {
    const statusMatch = statusFilter === "all" || request.status === statusFilter;
    const urgencyMatch = urgencyFilter === "all" || request.urgency === urgencyFilter;
    return statusMatch && urgencyMatch;
  });

  const parseMoney = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const num =
      typeof value === "string"
        ? Number.parseFloat(value.replace(/\s+/g, "").replace(",", "."))
        : Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const getRequestEstimatedCost = (request: PartRequirement): number | null => {
    const direct = parseMoney(request.estimatedCost);
    if (direct !== null) return direct;

    const unitPrice = parseMoney(request.partUnitPrice);
    const qty = Number(request.quantityNeeded || 0);
    if (unitPrice !== null && qty > 0) {
      return unitPrice * qty;
    }

    return null;
  };

  // Mutation pour mettre à jour une demande. L'id voyage avec les variables :
  // lire selectedRequest ici prenait la sélection du rendu précédent, car
  // Valider/Refuser appellent setSelectedRequest puis mutate dans le même clic.
  const updateRequestMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/part-requirements/${id}`, data),
    onSuccess: () => {
      toast({
        title: "Demande mise à jour",
        description: "La demande de pièce a été mise à jour avec succès.",
      });
      setIsUpdateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
      resetUpdateForm();
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "La demande n'a pas pu être mise à jour."),
      });
    },
  });
  // Réception et sortie déplacent du stock : un seul envoi par clic.
  const submitRequestUpdate = useSingleFlightMutate(updateRequestMutation.mutate);

  const resetUpdateForm = () => {
    setUpdateAction(null);
    setEstimatedCost("");
    setSupplierNotes("");
    setEmergencyOverrideReason("");
    setExpectedDeliveryDate("");
    setActualDeliveryDate("");
  };

  const handleViewDetails = (request: PartRequirement) => {
    setSelectedRequest(request);
    setIsDetailsDialogOpen(true);
  };

  const handleUpdateRequest = (request: PartRequirement, action: "order_override" | "receive") => {
    setSelectedRequest(request);
    setUpdateAction(action);
    setEstimatedCost(request.estimatedCost?.toString() || "");
    setSupplierNotes(request.supplierNotes || "");
    setExpectedDeliveryDate(request.expectedDeliveryDate || "");
    setActualDeliveryDate(
      action === "receive"
        ? request.actualDeliveryDate || getTodayLocalDate()
        : ""
    );
    setIsUpdateDialogOpen(true);
  };

  const submitUpdate = () => {
    if (!selectedRequest) return;

    const nextStatus =
      updateAction === "order_override"
        ? "ordered"
        : updateAction === "receive"
          ? "received"
          : selectedRequest.status;

    if (updateAction === "order_override" && emergencyOverrideReason.trim().length < 5) {
      toast({
        title: "Motif urgence requis",
        description: "Expliquez la raison business de la commande directe (minimum 5 caractères).",
        variant: "destructive",
      });
      return;
    }

    const updateData: any = {
      status: nextStatus,
    };

    if (estimatedCost) updateData.estimatedCost = parseFloat(estimatedCost);
    if (supplierNotes) updateData.supplierNotes = supplierNotes;
    if (updateAction === "order_override" && expectedDeliveryDate) {
      updateData.expectedDeliveryDate = expectedDeliveryDate;
    }
    if (updateAction === "receive") {
      updateData.actualDeliveryDate = actualDeliveryDate || getTodayLocalDate();
    }
    if (updateAction === "order_override") {
      updateData.emergencyOverrideReason = emergencyOverrideReason.trim();
    }

    submitRequestUpdate({ id: selectedRequest.id, data: updateData });
  };

  const getUrgencyBadge = (urgency: string) => {
    const variants = {
      low: "secondary",
      medium: "default", 
      high: "destructive",
      critical: "destructive"
    };
    
    const labels = {
      low: "Faible",
      medium: "Moyen",
      high: "Élevé", 
      critical: "Critique"
    };

    return (
      <Badge variant={variants[urgency as keyof typeof variants] as any}>
        {labels[urgency as keyof typeof labels]}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "secondary",
      approved: "default",
      ordered: "default",
      partially_received: "default",
      received: "default",
      delivered: "default",
      rejected: "destructive",
      cancel_requested: "secondary",
      cancelled: "destructive"
    };
    
    const labels: Record<string, string> = {
      pending: getPartRequirementStatusLabel("pending"),
      approved: getPartRequirementStatusLabel("approved"),
      ordered: getPartRequirementStatusLabel("ordered"),
      partially_received: getPartRequirementStatusLabel("partially_received"),
      received: getPartRequirementStatusLabel("received"),
      delivered: getPartRequirementStatusLabel("delivered"),
      rejected: getPartRequirementStatusLabel("rejected"),
      cancel_requested: getPartRequirementStatusLabel("cancel_requested"),
      cancelled: getPartRequirementStatusLabel("cancelled"),
      issued: getPartRequirementStatusLabel("issued"),
    };

    const icons = {
      pending: <Clock className="h-3 w-3 mr-1" />,
      approved: <CheckCircle className="h-3 w-3 mr-1" />,
      ordered: <Package className="h-3 w-3 mr-1" />,
      partially_received: <Truck className="h-3 w-3 mr-1" />,
      received: <PackageCheck className="h-3 w-3 mr-1" />,
      delivered: <Truck className="h-3 w-3 mr-1" />,
      rejected: <ThumbsDown className="h-3 w-3 mr-1" />,
      cancel_requested: <AlertTriangle className="h-3 w-3 mr-1" />,
      cancelled: <X className="h-3 w-3 mr-1" />
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] as any} className="flex items-center w-fit">
        {icons[status as keyof typeof icons]}
        {labels[status as keyof typeof labels]}
      </Badge>
    );
  };

  // Statistiques des demandes
  const stats = {
    total: filteredRequests.length,
    pending: filteredRequests.filter((r: PartRequirement) => r.status === 'pending').length,
    approved: filteredRequests.filter((r: PartRequirement) => r.status === 'approved').length,
    ordered: filteredRequests.filter((r: PartRequirement) => r.status === 'ordered').length,
    delivered: filteredRequests.filter((r: PartRequirement) => r.status === 'delivered' || r.status === 'received').length,
  };

  const urgencyStyles: Record<string, string> = {
    low: "bg-gray-100 text-gray-500",
    medium: "bg-yellow-100 text-yellow-700",
    high: "bg-orange-100 text-orange-700",
    critical: "bg-red-100 text-red-700",
  };
  const urgencyLabels: Record<string, string> = { low: "Faible", medium: "Moyen", high: "Élevé", critical: "Critique" };
  const reqStatusStyles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-blue-100 text-blue-700",
    ordered: "bg-purple-100 text-purple-700",
    partially_received: "bg-orange-100 text-orange-700",
    received: "bg-sky-100 text-sky-700",
    delivered: "bg-teal-100 text-teal-700",
    rejected: "bg-red-100 text-red-700",
    cancel_requested: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-600",
    issued: "bg-teal-100 text-teal-700",
  };
  const reqStatusLabels: Record<string, string> = {
    pending: getPartRequirementStatusLabel("pending"),
    approved: getPartRequirementStatusLabel("approved"),
    ordered: getPartRequirementStatusLabel("ordered"),
    partially_received: getPartRequirementStatusLabel("partially_received"),
    received: getPartRequirementStatusLabel("received"),
    delivered: getPartRequirementStatusLabel("delivered"),
    rejected: getPartRequirementStatusLabel("rejected"),
    cancel_requested: getPartRequirementStatusLabel("cancel_requested"),
    cancelled: getPartRequirementStatusLabel("cancelled"),
    issued: getPartRequirementStatusLabel("issued"),
  };

  return (
    <div className="space-y-5">

      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Stock / Inventaire</span>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Demandes de pièces</h1>
                <p className="text-sm text-gray-400 mt-0.5">Suivi et validation des demandes de réapprovisionnement</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setLocation('/inventory')} data-testid="btn-new-request"
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5 shrink-0">
              <Package className="h-3.5 w-3.5" />Nouvelle demande
            </Button>
          </div>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              { icon: <Package className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50", label: "Total", value: stats.total },
              { icon: <Clock className="h-4 w-4 text-orange-500" />, iconBg: "bg-orange-50", label: "En attente", value: stats.pending, alert: stats.pending > 0 },
              { icon: <CheckCircle className="h-4 w-4 text-green-600" />, iconBg: "bg-green-50", label: "Approuvées", value: stats.approved },
              { icon: <ShoppingCart className="h-4 w-4 text-purple-500" />, iconBg: "bg-purple-50", label: "Commandées", value: stats.ordered },
              { icon: <Truck className="h-4 w-4 text-teal-500" />, iconBg: "bg-teal-50", label: "Livrées", value: stats.delivered },
            ].map((kpi) => (
              <div key={kpi.label} className={`rounded-xl border px-4 py-3.5 flex flex-col gap-1 ${(kpi as any).alert ? 'border-orange-200 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}>
                <div className={`w-7 h-7 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>{kpi.icon}</div>
                <p className="text-[11px] font-medium text-gray-500 mt-1">{kpi.label}</p>
                <p className={`text-xl font-bold leading-none ${(kpi as any).alert ? 'text-orange-600' : 'text-gray-800'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Process help ── */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50/30 overflow-hidden">
        <div
          className="px-5 py-4 flex items-center justify-between cursor-pointer"
          onClick={() => setShowProcessHelp(!showProcessHelp)}
          data-testid="toggle-process-help"
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <HelpCircle className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800">Comment fonctionne le réapprovisionnement ?</p>
              <p className="text-xs text-blue-500 mt-0.5">
                {isRequestApprover ? "Vous validez les demandes avant traitement" : "Flux standard via Achats · override urgence avec motif"}
              </p>
            </div>
          </div>
          {showProcessHelp ? <ChevronUp className="h-4 w-4 text-blue-500" /> : <ChevronDown className="h-4 w-4 text-blue-500" />}
        </div>
        {showProcessHelp && (
          <div className="px-5 pb-5 space-y-4">
            {/* Stepper */}
            <div className="flex items-center justify-between bg-white rounded-xl border border-blue-100 p-4 overflow-x-auto gap-2">
              {[
                { icon: <Clock className="h-4 w-4 text-orange-600" />, bg: "bg-orange-100", label: getPartRequirementStatusLabel("pending"), sub: "Atelier valide" },
                { icon: <ThumbsUp className="h-4 w-4 text-green-600" />, bg: "bg-green-100", label: getPartRequirementStatusLabel("approved"), sub: "Magasin commande" },
                { icon: <ShoppingCart className="h-4 w-4 text-purple-600" />, bg: "bg-purple-100", label: getPartRequirementStatusLabel("ordered"), sub: "En transit" },
                { icon: <PackageCheck className="h-4 w-4 text-teal-600" />, bg: "bg-teal-100", label: getPartRequirementStatusLabel("received"), sub: "Stock crédité" },
                { icon: <Truck className="h-4 w-4 text-cyan-600" />, bg: "bg-cyan-100", label: getPartRequirementStatusLabel("issued"), sub: "Remise à l'atelier" },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div className={`w-9 h-9 rounded-full ${step.bg} flex items-center justify-center mb-1.5`}>{step.icon}</div>
                    <span className="text-xs font-semibold text-gray-700 text-center">{step.label}</span>
                    <span className="text-[10px] text-gray-400 text-center">{step.sub}</span>
                  </div>
                </div>
              ))}
            </div>
            {/* Roles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className={`rounded-xl border px-4 py-3 ${isRequestApprover ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                  Validation (Atelier / Admin / Secrétariat)
                  {isRequestApprover && <span className="ml-2 rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold normal-case tracking-normal">Vous</span>}
                </p>
                <ul className="text-xs space-y-1 text-gray-500">
                  <li>• Valider ou refuser les demandes en attente</li>
                  <li>• Créer des demandes depuis l'inventaire</li>
                  <li>• Suivre l'avancement des livraisons</li>
                </ul>
              </div>
              <div className={`rounded-xl border px-4 py-3 ${isSupplyOperator ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                  Magasin / Secrétariat
                  {isSupplyOperator && <span className="ml-2 rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold normal-case tracking-normal">Vous</span>}
                </p>
                <ul className="text-xs space-y-1 text-gray-500">
                  <li>• Créer des demandes proactives (stock bas / rupture)</li>
                  <li>• Passer commande via Achats (flux standard)</li>
                  <li>• Override urgence avec motif obligatoire</li>
                  <li>• Confirmer la réception des pièces</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Awaiting parts WOs (warehouse only) ── */}
      {isSupplyOperator && awaitingPartsWorkOrders.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Ordres de travail bloqués</p>
              <p className="text-xs text-amber-600 mt-0.5">Ces OTs ne peuvent pas avancer — pièces en rupture de stock</p>
            </div>
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-600">
              {awaitingPartsWorkOrders.length} OT
            </span>
          </div>
          <div className="p-4 space-y-3">
            {isLoadingAwaitingParts ? (
              <div className="text-center py-4 text-gray-400 text-sm">Chargement...</div>
            ) : awaitingPartsWorkOrders.map((wo) => (
              <div key={wo.id} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm" data-testid={`awaiting-parts-wo-${wo.id}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Wrench className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        OT #{wo.id} — {wo.title}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${wo.priority === 'critical' ? 'bg-red-100 text-red-700' : wo.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                          {wo.priority === 'critical' ? 'Critique' : wo.priority === 'high' ? 'Urgent' : wo.priority === 'medium' ? 'Normal' : 'Faible'}
                        </span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {wo.vehicle ? `${wo.vehicle.registrationNumber} — ${wo.vehicle.brand} ${wo.vehicle.model}` : 'Véhicule N/A'}
                        {wo.technician && ` · Tech: ${wo.technician.name}`}
                      </p>
                    </div>
                  </div>
                  <button className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" onClick={() => setLocation(`/maintenance/work-orders/${wo.id}`)} data-testid={`btn-view-wo-${wo.id}`}>
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1">
                    <Package className="h-3 w-3" />Pièces en attente ({wo.pendingPartsCount})
                  </p>
                  <div className="space-y-1.5">
                    {wo.pendingParts.map((part) => (
                      <div key={part.requestId} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{part.partName}</span>
                          <span className="text-[11px] font-mono text-gray-400">({part.partReference})</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">×{part.quantityNeeded}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${part.status === 'ordered' ? 'bg-purple-100 text-purple-700' : part.status === 'approved' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {part.status === 'ordered' ? 'Commandé' : part.status === 'approved' ? 'Approuvé' : 'En attente'}
                          </span>
                          {part.expectedDeliveryDate && (
                            <span className="text-xs text-gray-400 flex items-center gap-0.5">
                              <Truck className="h-3 w-3" />{new Date(part.expectedDeliveryDate).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                          <button
                            className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
                            onClick={() => {
                              const req = requests.find(r => r.id === part.requestId);
                              if (req) {
                                const permissions = getRequestActionPermissions(req);
                                if (permissions.canReceive) handleUpdateRequest(req, "receive");
                                else if (req.linkedPurchaseOrderId) setLocation(`/procurement/orders/${req.linkedPurchaseOrderId}`);
                                else setLocation(getProcurementPrefillUrl(req));
                              }
                            }}
                            data-testid={`btn-manage-request-${part.requestId}`}
                          >
                            {(() => {
                              const req = requests.find(r => r.id === part.requestId);
                              const p = req ? getRequestActionPermissions(req) : null;
                              if (p?.canReceive) return "Réceptionner";
                              if (req?.linkedPurchaseOrderId) return "Suivre commande";
                              return "Passer la commande";
                            })()}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Requests table card ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
            <Package className="h-3.5 w-3.5 text-green-600" />
          </div>
          <p className="text-sm font-semibold text-gray-800">Liste des demandes</p>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-8 text-xs border-gray-100 bg-gray-50">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
                <SelectItem value="approved">Approuvé</SelectItem>
                <SelectItem value="ordered">Commandé</SelectItem>
                <SelectItem value="received">{getPartRequirementStatusLabel("received")}</SelectItem>
                <SelectItem value="delivered">Livré</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
              </SelectContent>
            </Select>
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs border-gray-100 bg-gray-50">
                <SelectValue placeholder="Urgence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes urgences</SelectItem>
                <SelectItem value="low">Faible</SelectItem>
                <SelectItem value="medium">Moyen</SelectItem>
                <SelectItem value="high">Élevé</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-gray-400">
              {filteredRequests.length} demande{filteredRequests.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["Pièce", "Demandeur", "Qté", "Urgence", "Statut", "Date", "Coût", ""].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap ${i === 7 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5"><div className="h-4 w-24 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Package className="h-9 w-9 opacity-30" />
                      <p className="text-sm font-medium">
                        {statusFilter !== "all" || urgencyFilter !== "all" ? "Aucune demande ne correspond aux filtres" : "Aucune demande pour le moment"}
                      </p>
                      <button className="mt-1 text-xs text-green-600 underline" onClick={() => setLocation('/inventory')}>
                        Aller à l'inventaire pour créer une demande
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRequests.map((request: PartRequirement) => {
                  const permissions = getRequestActionPermissions(request);
                  const needsMyAction = permissions.needsMyAction;
                  const requestEstimatedCost = getRequestEstimatedCost(request);
                  const urgencyBorder = { critical: "border-l-red-500", high: "border-l-orange-400", medium: "border-l-yellow-400", low: "border-l-blue-200" }[request.urgency] || "border-l-transparent";

                  return (
                    <tr
                      key={request.id}
                      className={`group border-b border-gray-50 last:border-0 transition-colors border-l-2 ${needsMyAction ? `${urgencyBorder} bg-yellow-50/50 hover:bg-yellow-50/80` : `${urgencyBorder} hover:bg-gray-50/60`}`}
                      data-testid={`row-request-${request.id}`}
                    >
                      {/* Pièce */}
                      <td className="px-4 py-3.5">
                        <div>
                          {needsMyAction && (
                            <span className="rounded-full bg-yellow-100 text-yellow-700 px-2 py-0.5 text-[10px] font-bold mr-1.5">Action requise</span>
                          )}
                          <p className="font-medium text-gray-800 inline">{request.partName}</p>
                          <p className="text-[11px] font-mono text-gray-400 mt-0.5">{request.partReference}</p>
                          {request.status === "received" || request.status === "issued" ? (
                            <PartReceptionLine reception={{ receivedBy: null, receivedByName: request.receivedByName ?? null, receivedAt: request.receivedAt ?? null }} />
                          ) : null}
                        </div>
                      </td>
                      {/* Demandeur */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm text-gray-600">{request.requesterName}</span>
                      </td>
                      {/* Qté */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-semibold text-gray-800 tabular-nums">{request.quantityNeeded}</span>
                      </td>
                      {/* Urgence */}
                      <td className="px-4 py-3.5">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${urgencyStyles[request.urgency] || 'bg-gray-100 text-gray-500'}`}>
                          {urgencyLabels[request.urgency] || request.urgency}
                        </span>
                      </td>
                      {/* Statut */}
                      <td className="px-4 py-3.5">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${reqStatusStyles[request.status] || 'bg-gray-100 text-gray-500'}`}>
                          {reqStatusLabels[request.status] || request.status}
                        </span>
                      </td>
                      {/* Date */}
                      <td className="px-4 py-3.5">
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {new Date(request.createdAt).toLocaleDateString('fr-FR')}
                        </span>
                      </td>
                      {/* Coût */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm text-gray-600 tabular-nums">
                          {requestEstimatedCost !== null ? formatCurrency(requestEstimatedCost) : "—"}
                        </span>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" onClick={() => handleViewDetails(request)} title="Voir demande" aria-label="Voir demande" data-testid={`btn-view-${request.id}`}>
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {permissions.canViewLinkedOrder && request.linkedPurchaseOrderId && (
                            <button className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500 transition-colors" onClick={() => setLocation(`/procurement/orders/${request.linkedPurchaseOrderId}`)} title="Voir bon de commande" aria-label="Voir bon de commande" data-testid={`btn-view-linked-order-${request.id}`}>
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {permissions.canApproveReject && (
                            <>
                              <button className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors" onClick={() => { setSelectedRequest(request); submitRequestUpdate({ id: request.id, data: { status: 'approved' } }); }} disabled={updateRequestMutation.isPending} title="Valider" data-testid={`btn-approve-${request.id}`}>
                                <ThumbsUp className="h-3.5 w-3.5" />
                              </button>
                              <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" onClick={() => { setSelectedRequest(request); submitRequestUpdate({ id: request.id, data: { status: 'cancelled' } }); }} disabled={updateRequestMutation.isPending} title="Refuser" data-testid={`btn-reject-${request.id}`}>
                                <ThumbsDown className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {permissions.canOrder && (
                            <>
                              <button className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-500 transition-colors" onClick={() => setLocation(getProcurementPrefillUrl(request))} title="Passer la commande" data-testid={`btn-procurement-${request.id}`}>
                                <ShoppingCart className="h-3.5 w-3.5" />
                              </button>
                              <button className="p-1.5 rounded-lg hover:bg-orange-50 text-orange-500 transition-colors" onClick={() => handleUpdateRequest(request, "order_override")} title="Urgence" data-testid={`btn-order-override-${request.id}`}>
                                <AlertTriangle className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {permissions.canReceive && (
                            <button className="p-1.5 rounded-lg hover:bg-teal-50 text-teal-600 transition-colors" onClick={() => handleUpdateRequest(request, "receive")} title="Marquer livré" data-testid={`btn-deliver-${request.id}`}>
                              <PackageCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {permissions.canTrackOrder && request.linkedPurchaseOrderId && !permissions.canViewLinkedOrder && (
                            <button className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500 transition-colors" onClick={() => setLocation(`/procurement/orders/${request.linkedPurchaseOrderId}`)} data-testid={`btn-track-order-${request.id}`}>
                              <ShoppingCart className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── dialogs (unchanged) ── */}
      {/* Dialog de détails */}
      <Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
        <DialogContent className="sm:max-w-[580px] p-0 overflow-hidden gap-0">
          {selectedRequest && (
            (() => {
              const selectedRequestEstimatedCost = getRequestEstimatedCost(selectedRequest);
              return (
            <>
              {/* ── Mini hero header ── */}
              <div className="px-5 pt-5 pb-4 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)", borderBottom: "1px solid #86efac" }}>
                <div className="absolute inset-0 pointer-events-none"
                  style={{ backgroundImage: "radial-gradient(rgba(22,163,74,0.10) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                <div className="relative z-10">
                  <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-1">Demande de pièce</p>
                  <h2 className="font-black text-green-900 text-lg leading-tight">{selectedRequest.partName}</h2>
                  {selectedRequest.partReference && (
                    <p className="text-[11px] font-mono text-green-700/60 mt-0.5">{selectedRequest.partReference}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                    {getStatusBadge(selectedRequest.status)}
                    {getUrgencyBadge(selectedRequest.urgency)}
                  </div>
                </div>
              </div>

              {/* ── Corps ── */}
              <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">

                {/* Grille infos clés */}
                <div className="grid grid-cols-2 gap-2.5">
                    {([
                    { label: "Demandeur",      value: selectedRequest.requesterName,                                         Icon: User },
                    { label: "Quantité",        value: String(selectedRequest.quantityNeeded),                                Icon: Package },
                    { label: "Date de demande", value: new Date(selectedRequest.createdAt).toLocaleDateString('fr-FR'),       Icon: Calendar },
                    ...(selectedRequestEstimatedCost !== null
                      ? [{ label: "Coût estimé", value: formatCurrency(selectedRequestEstimatedCost), Icon: Banknote }]
                      : []),
                  ] as { label: string; value: string; Icon: React.ElementType }[]).map(({ label, value, Icon }) => (
                    <div key={label} className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <Icon className="w-3 h-3 text-gray-400" />
                        <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">{label}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Dates de livraison */}
                {(selectedRequest.expectedDeliveryDate || selectedRequest.actualDeliveryDate) && (
                  <div className="grid grid-cols-2 gap-2.5">
                    {selectedRequest.expectedDeliveryDate && (
                      <div className="rounded-xl p-3" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <Truck className="w-3 h-3 text-blue-500" />
                          <p className="text-[10px] font-bold tracking-widest uppercase text-blue-500">Livraison prévue</p>
                        </div>
                        <p className="text-sm font-semibold text-blue-800">
                          {new Date(selectedRequest.expectedDeliveryDate).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    )}
                    {selectedRequest.actualDeliveryDate && (
                      <div className="rounded-xl p-3" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <p className="text-[10px] font-bold tracking-widest uppercase text-green-600">Livraison réelle</p>
                        </div>
                        <p className="text-sm font-semibold text-green-800">
                          {new Date(selectedRequest.actualDeliveryDate).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Raison */}
                <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div className="flex items-center gap-1 mb-1">
                    <Info className="w-3 h-3 text-gray-400" />
                    <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">Raison de la demande</p>
                  </div>
                  <p className="text-sm text-gray-700">{selectedRequest.reason}</p>
                </div>

                {/* Notes internes */}
                {selectedRequest.notes && (
                  <div className="rounded-xl p-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                    <div className="flex items-center gap-1 mb-1">
                      <StickyNote className="w-3 h-3 text-amber-600" />
                      <p className="text-[10px] font-bold tracking-widest uppercase text-amber-600">Notes</p>
                    </div>
                    <p className="text-sm text-amber-900">{selectedRequest.notes}</p>
                  </div>
                )}

                {/* Notes fournisseur */}
                {selectedRequest.supplierNotes && (
                  <div className="rounded-xl p-3" style={{ background: "#faf5ff", border: "1px solid #e9d5ff" }}>
                    <div className="flex items-center gap-1 mb-1">
                      <MessageSquare className="w-3 h-3 text-purple-500" />
                      <p className="text-[10px] font-bold tracking-widest uppercase text-purple-500">Notes fournisseur</p>
                    </div>
                    <p className="text-sm text-purple-800">{selectedRequest.supplierNotes}</p>
                  </div>
                )}

                {/* Commande liée */}
                {selectedRequest.linkedPurchaseOrderId && (
                  <div className="rounded-xl p-3 flex items-center justify-between gap-3"
                    style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                    <div>
                      <p className="text-[10px] font-bold tracking-widest uppercase text-blue-500 mb-0.5">Bon de commande lié</p>
                      <p className="text-sm font-semibold text-blue-800">
                        #{selectedRequest.linkedPurchaseOrderId}
                        {selectedRequest.linkedPurchaseOrderStatus && (
                          <span className="ml-1.5 text-[11px] font-normal text-blue-600">
                            · {getOrderStatusLabel(selectedRequest.linkedPurchaseOrderStatus)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setLocation(`/procurement/orders/${selectedRequest.linkedPurchaseOrderId}`)}
                      data-testid={`btn-dialog-view-linked-order-${selectedRequest.id}`}
                      className="text-white shrink-0"
                      style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      Voir BC
                    </Button>
                  </div>
                )}
              </div>
            </>
              );
            })()
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog de mise à jour */}
      <Dialog
        open={isUpdateDialogOpen}
        onOpenChange={(open) => {
          setIsUpdateDialogOpen(open);
          if (!open) resetUpdateForm();
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {updateAction === "order_override" ? "Commande directe urgente" : "Confirmer la réception"}
            </DialogTitle>
            <DialogDescription>
              {updateAction === "order_override"
                ? "Exception: contourner le flux Achats. Motif obligatoire. Le statut passera à Commandée."
                : "Confirmez les informations de réception. Le statut passera automatiquement à « Entrée en stock »."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Statut cible</Label>
              <div className="h-10 px-3 border rounded-md flex items-center bg-muted/20">
                {updateAction === "order_override" ? "Commandée (override urgence)" : getPartRequirementStatusLabel("received")}
              </div>
            </div>

            <div>
              <Label htmlFor="estimated-cost">Coût estimé (FCFA)</Label>
              <Input
                id="estimated-cost"
                type="number"
                step="0.01"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="Coût estimé"
              />
            </div>

            <div>
              <Label htmlFor="supplier-notes">Notes fournisseur</Label>
              <Textarea
                id="supplier-notes"
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                placeholder="Notes du fournisseur..."
                rows={3}
              />
            </div>

            {updateAction === "order_override" ? (
              <div>
                <Label htmlFor="override-reason">Motif urgence (obligatoire)</Label>
                <Textarea
                  id="override-reason"
                  value={emergencyOverrideReason}
                  onChange={(e) => setEmergencyOverrideReason(e.target.value)}
                  placeholder="Ex: véhicule bloqué mission client critique, commande fournisseur immédiate..."
                  rows={3}
                />
              </div>
            ) : null}

            {updateAction === "order_override" ? (
              <div>
                <Label htmlFor="expected-delivery">Date de livraison prévue</Label>
                <Input
                  id="expected-delivery"
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="actual-delivery">Date de livraison réelle</Label>
                <Input
                  id="actual-delivery"
                  type="date"
                  value={actualDeliveryDate}
                  onChange={(e) => setActualDeliveryDate(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Date préremplie. Si laissée vide, la date du jour est enregistrée automatiquement.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUpdateDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={submitUpdate}
              disabled={updateRequestMutation.isPending}
            >
              {updateRequestMutation.isPending
                ? "Traitement..."
                : updateAction === "order_override"
                  ? "Commander en urgence"
                  : "Confirmer réception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
