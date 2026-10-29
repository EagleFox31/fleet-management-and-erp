import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft, ArrowRight, Package, Calendar, Truck, CheckCircle,
  FileText, XCircle, Building2, User, ShoppingCart, History,
  ClipboardList, AlertTriangle, Send, CheckCircle2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { formatPrice } from "@/lib/utils";
import { useRetourArriere } from "@/hooks/useRetourArriere";

interface PurchaseOrderLine {
  id: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  unitPrice: string;
  totalPrice: string;
  deliveryStatus: string;
  description: string | null;
  reference: string | null;
  part?: { id: number; name: string; reference: string };
  requirement?: { id: number; reason: string; urgency: string };
}

interface PurchaseOrderDetails {
  order: {
    id: number;
    orderNumber: string;
    orderDate: string;
    expectedDeliveryDate: string | null;
    actualDeliveryDate: string | null;
    deliveryCode: string | null;
    status: string;
    totalAmountHT: string;
    vatAmount: string;
    totalAmountTTC: string;
    discountPercentage: string;
    discountAmount: string;
    urgency: string;
    notes: string | null;
  };
  supplier?: { id: number; name: string; email?: string; phone?: string };
  linkedInvoice?: {
    id: number;
    invoiceNumber: string;
    status: string;
    totalAmountTTC: string | null;
    createdAt: string | null;
  };
  lines: PurchaseOrderLine[];
  creator?: { id: number; name: string };
  approver?: { id: number; name: string };
  requesters?: Array<{ id: number; name: string; role?: string }>;
  statusHistory?: Array<{
    timestamp: string;
    fromStatus: string;
    toStatus: string;
    actor: string;
    deliveryCode?: string;
    cancellationReason?: string;
  }>;
}

const statusConfig: Record<string, { label: string; color: string; icon: any; accent: string; accentBg: string; accentBorder: string }> = {
  draft:     { label: "À préparer",           color: "bg-gray-100 text-gray-700 border-gray-200",       icon: FileText,     accent: "#6b7280", accentBg: "#f9fafb", accentBorder: "#e5e7eb" },
  sent:      { label: "Transmise fournisseur", color: "bg-blue-50 text-blue-700 border-blue-200",        icon: Send,         accent: "#2563eb", accentBg: "#eff6ff", accentBorder: "#bfdbfe" },
  confirmed: { label: "Confirmée fournisseur", color: "bg-green-50 text-green-700 border-green-200",     icon: CheckCircle,  accent: "#16a34a", accentBg: "#f0fdf4", accentBorder: "#bbf7d0" },
  cancellation_requested: { label: "Annulation demandée", color: "bg-orange-50 text-orange-700 border-orange-200", icon: AlertTriangle, accent: "#ea580c", accentBg: "#fff7ed", accentBorder: "#fdba74" },
  partial:   { label: "Réception partielle",   color: "bg-amber-50 text-amber-700 border-amber-200",     icon: Package,      accent: "#d97706", accentBg: "#fffbeb", accentBorder: "#fde68a" },
  delivered: { label: "Réception complète",    color: "bg-indigo-50 text-indigo-700 border-indigo-200",  icon: Truck,        accent: "#7c3aed", accentBg: "#f5f3ff", accentBorder: "#ddd6fe" },
  completed: { label: "Clôturée",              color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, accent: "#059669", accentBg: "#ecfdf5", accentBorder: "#a7f3d0" },
  cancelled: { label: "Annulée",               color: "bg-red-50 text-red-700 border-red-200",           icon: XCircle,      accent: "#dc2626", accentBg: "#fef2f2", accentBorder: "#fecaca" },
};

const lineStatusConfig: Record<string, { label: string; color: string; dot: string }> = {
  pending:   { label: "En attente",           color: "bg-gray-100 text-gray-600 border-gray-200",      dot: "#9ca3af" },
  partial:   { label: "Partielle",            color: "bg-amber-50 text-amber-700 border-amber-200",    dot: "#d97706" },
  delivered: { label: "Reçue en magasin",     color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "#7c3aed" },
  accepted:  { label: "Validée au contrôle",  color: "bg-green-50 text-green-700 border-green-200",    dot: "#16a34a" },
  rejected:  { label: "Refusée au contrôle",  color: "bg-red-50 text-red-700 border-red-200",          dot: "#dc2626" },
};

const urgencyConfig: Record<string, { label: string; color: string; icon: any }> = {
  low:      { label: "Faible",   color: "bg-gray-100 text-gray-600",       icon: Clock },
  normal:   { label: "Normale",  color: "bg-blue-50 text-blue-600",        icon: Clock },
  high:     { label: "Haute",    color: "bg-amber-50 text-amber-700",      icon: AlertTriangle },
  critical: { label: "Critique", color: "bg-red-50 text-red-700",          icon: AlertTriangle },
};

const lineDeliveryStatusLabel: Record<string, string> = {
  pending:   "En attente fournisseur",
  partial:   "Partiellement reçue",
  delivered: "Reçue au magasin",
  accepted:  "Contrôlée et validée",
  rejected:  "Refusée au contrôle",
};

const supplierInvoiceStatusLabel: Record<string, string> = {
  received: "Reçue",
  validated: "Validée",
  approved: "Approuvée",
  paid: "Payée",
  disputed: "Contestée",
};

const roleLabel: Record<string, string> = {
  admin:            "Administrateur",
  workshop_manager: "Chef d'atelier",
  warehouse:        "Magasinier",
  secretary:        "Secrétaire",
  logistics:        "Achats / Logistique",
  technician:       "Technicien",
};

const humanizeActorRole = (actor: string | null | undefined): string => {
  if (!actor) return "Non renseigné";

  return actor.replace(/\(([^)]+)\)\s*$/, (_full, roleRaw: string) => {
    const normalizedRole = roleRaw.trim().toLowerCase();
    const prettyRole = roleLabel[normalizedRole] || roleRaw;
    return `(${prettyRole})`;
  });
};

const workflowSteps: Array<{ key: 'draft' | 'sent' | 'confirmed' | 'delivered' | 'completed'; title: string; subtitle: string }> = [
  { key: 'draft',     title: 'À préparer',          subtitle: 'Préparation interne' },
  { key: 'sent',      title: 'Transmise',            subtitle: 'BDC envoyé' },
  { key: 'confirmed', title: 'Confirmée',            subtitle: 'Fournisseur OK' },
  { key: 'delivered', title: 'Réception',            subtitle: 'Pièces reçues' },
  { key: 'completed', title: 'Clôturée',             subtitle: 'Dossier terminé' },
];
const PARTS_ORDER_ACTION_ROLES = ["admin", "secretary", "warehouse"] as const;
const NON_PARTS_ORDER_ACTION_ROLES = ["admin", "secretary", "warehouse", "logistics"] as const;
const DELIVERY_ACTION_ROLES = ["admin", "warehouse"] as const;

const orderStatusHelp: Record<string, string> = {
  draft:     "La commande est préparée mais pas encore envoyée au fournisseur.",
  sent:      "La commande a été envoyée et attend la confirmation du fournisseur.",
  confirmed: "Le fournisseur a confirmé la commande, en attente de réception.",
  cancellation_requested: "Demande d'annulation transmise au fournisseur, en attente de son retour.",
  partial:   "Une partie des articles est déjà arrivée en magasin.",
  delivered: "Commande livrée: le dossier passe maintenant à la finance (facture/validation/règlement).",
  completed: "Commande clôturée automatiquement après fin du traitement finance.",
  cancelled: "Commande annulée, aucune réception attendue.",
};

const lineDeliveryStatusHelp: Record<string, string> = {
  pending:   "Le fournisseur n'a pas encore livré cet article.",
  partial:   "Une partie de la quantité a été livrée.",
  delivered: "L'article est livré en magasin (contrôle à finaliser si besoin).",
  accepted:  "L'article a été contrôlé puis validé.",
  rejected:  "L'article a été reçu mais refusé au contrôle.",
};

const getLineStatusDisplay = (lineStatus: string, orderStatus: string) => {
  if (lineStatus === "pending") {
    if (orderStatus === "draft")     return { label: "Non transmise au fournisseur", help: "La commande n'est pas encore envoyée au fournisseur." };
    if (orderStatus === "sent")      return { label: "Transmise — en attente de confirmation", help: "La commande est envoyée et attend la confirmation du fournisseur." };
    if (orderStatus === "confirmed") return { label: "En attente de livraison", help: "Le fournisseur a confirmé mais n'a pas encore livré cet article." };
    if (orderStatus === "cancellation_requested") return { label: "Annulation demandée", help: "Une demande d'annulation a été envoyée au fournisseur pour cet article." };
    if (orderStatus === "delivered" || orderStatus === "completed") {
      return { label: "Reçue au magasin", help: "La commande est réceptionnée. Statut ligne aligné automatiquement." };
    }
  }
  return {
    label: lineDeliveryStatusLabel[lineStatus] || lineStatus,
    help:  lineDeliveryStatusHelp[lineStatus]  || "Statut de livraison.",
  };
};

export default function PurchaseOrderDetailsPage() {
  const retourArriere = useRetourArriere("/procurement/orders");
  const params   = useParams();
  const orderId  = parseInt(params.id!);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user }  = useAuth();
  const queryClient = useQueryClient();

  const [showDeliveryDialog, setShowDeliveryDialog] = useState(false);
  const [deliveryCode, setDeliveryCode]             = useState("");
  const [showCancellationDialog, setShowCancellationDialog] = useState(false);
  const [cancellationReason, setCancellationReason]         = useState("");
  const [pendingStatus, setPendingStatus]           = useState<string | null>(null);

  const { data: orderDetails, isLoading } = useQuery<PurchaseOrderDetails>({
    queryKey: [`/api/purchase-orders/${orderId}`],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, deliveryCode, cancellationReason }: { status: string; deliveryCode?: string; cancellationReason?: string }) => {
      const response = await apiRequest("PATCH", `/api/purchase-orders/${orderId}/status`, { status, deliveryCode, cancellationReason });
      return await response.json();
    },
    onSuccess: async (updatedOrder) => {
      queryClient.setQueryData<PurchaseOrderDetails | undefined>(
        [`/api/purchase-orders/${orderId}`],
        (previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            order: {
              ...previous.order,
              ...updatedOrder,
            },
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/overdue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/statistics"] });
      await queryClient.refetchQueries({ queryKey: [`/api/purchase-orders/${orderId}`], type: "active" });
      setShowDeliveryDialog(false);
      setShowCancellationDialog(false);
      setDeliveryCode("");
      setCancellationReason("");
      setPendingStatus(null);
      toast({ title: "Statut mis à jour", description: "Le statut de la commande a été modifié avec succès" });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Le statut de la commande n'a pas pu être modifié."), variant: "destructive" });
    },
  });
  // La livraison confirmée entre du stock : un seul envoi par clic.
  const submitStatusUpdate = useSingleFlightMutate(updateStatusMutation.mutate);

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "delivered") { setPendingStatus(newStatus); setShowDeliveryDialog(true); }
    else if (newStatus === "cancellation_requested") { setPendingStatus(newStatus); setShowCancellationDialog(true); }
    else submitStatusUpdate({ status: newStatus });
  };

  const handleConfirmDelivery = () => {
    if (!deliveryCode.trim()) {
      toast({ title: "Code requis", description: "Veuillez saisir un code de livraison", variant: "destructive" });
      return;
    }
    submitStatusUpdate({ status: pendingStatus!, deliveryCode: deliveryCode.trim() });
  };

  const handleConfirmCancellationRequest = () => {
    if (!cancellationReason.trim()) {
      toast({ title: "Motif requis", description: "Veuillez saisir le motif d'annulation fournisseur", variant: "destructive" });
      return;
    }
    submitStatusUpdate({ status: pendingStatus!, cancellationReason: cancellationReason.trim() });
  };

  const formatCurrency = (amount: string | number) => formatPrice(Number(amount));

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return "-";
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return dateString;
    return parsed.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <span className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-green-500 animate-spin" />
          Chargement de la commande…
        </div>
      </div>
    );
  }

  if (!orderDetails) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12 text-gray-500">Commande non trouvée</div>
      </div>
    );
  }

  const { order, supplier, linkedInvoice, lines, creator, approver, requesters = [], statusHistory = [] } = orderDetails;
  const findTraceForStatuses = (statuses: string[]) => {
    return statusHistory
      .slice()
      .reverse()
      .find((item) => statuses.includes(item.toStatus));
  };

  const sentTrace = findTraceForStatuses(["sent"]);
  const confirmedTrace = findTraceForStatuses(["confirmed"]);
  const cancellationRequestedTrace = findTraceForStatuses(["cancellation_requested"]);
  const receivedTrace = findTraceForStatuses(["delivered", "partial"]);
  const completedTrace = findTraceForStatuses(["completed"]);
  const cancelledTrace = findTraceForStatuses(["cancelled"]);

  const sentByActor = sentTrace?.actor || approver?.name || null;

  const currentUserRole       = user?.role || "";
  const isPartsLinkedOrder    = lines.some((line) => Boolean(line.part || line.requirement));
  const allowedCommandRoles = isPartsLinkedOrder ? PARTS_ORDER_ACTION_ROLES : NON_PARTS_ORDER_ACTION_ROLES;
  const canManageOrderActions = allowedCommandRoles.includes(currentUserRole as any);
  const canRecordDelivery = DELIVERY_ACTION_ROLES.includes(currentUserRole as any);
  const workflowActionRights: Array<{ action: string; roles: string[] }> = [
    {
      action: "Envoyer au fournisseur",
      roles: allowedCommandRoles.map((role) => roleLabel[role] || role),
    },
    {
      action: "Demander / confirmer annulation",
      roles: allowedCommandRoles.map((role) => roleLabel[role] || role),
    },
    {
      action: "Enregistrer la livraison",
      roles: DELIVERY_ACTION_ROLES.map((role) => roleLabel[role] || role),
    },
    {
      action: "Clôture commande (automatique)",
      roles: ["Système (après facture payée)"],
    },
    {
      action: "Confirmer commande",
      roles: allowedCommandRoles.map((role) => roleLabel[role] || role),
    },
  ];
  const visibleOrderNotes     = (order.notes || "").split("\n").filter((l) => !l.trim().startsWith("[TRACE_PO]")).join("\n").trim();
  const statusInfo            = statusConfig[order.status] || statusConfig.draft;
  const StatusIcon            = statusInfo.icon;
  const urgencyInfo           = urgencyConfig[order.urgency] || urgencyConfig.normal;
  const UrgencyIcon           = urgencyInfo.icon;
  const canDirectCancelOrder  = canManageOrderActions && ['draft', 'sent'].includes(order.status);
  const canRequestSupplierCancellation = canManageOrderActions && ['confirmed', 'partial'].includes(order.status);
  const rollbackStatusAfterCancellationRefusal = cancellationRequestedTrace?.fromStatus === "partial" ? "partial" : "confirmed";
  const statusProgressOrder   = ['draft', 'sent', 'confirmed', 'partial', 'delivered', 'completed'] as const;
  const stepperStatus         = order.status === 'cancellation_requested' ? 'confirmed' : order.status;
  const currentStatusProgressIndex = Math.max(statusProgressOrder.indexOf(stepperStatus as any), 0);

  const statusActions: Array<{ status: string; label: string }> = (() => {
    if (!canManageOrderActions) return [];
    switch (order.status) {
      case 'draft':             return [{ status: 'sent',      label: 'Envoyer au fournisseur' }];
      case 'sent':              return [{ status: 'confirmed', label: 'Confirmer la commande' }];
      case 'confirmed':
      case 'partial':           return canRecordDelivery ? [{ status: 'delivered', label: 'Enregistrer la livraison' }] : [];
      case 'cancellation_requested':
        return [
          { status: 'cancelled', label: "Confirmer l'annulation fournisseur" },
          {
            status: rollbackStatusAfterCancellationRefusal,
            label: rollbackStatusAfterCancellationRefusal === 'partial'
              ? "Refus fournisseur (retour réception partielle)"
              : "Refus fournisseur (retour confirmée)"
          },
        ];
      case 'delivered':         return [];
      default:                  return [];
    }
  })();

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">

          {/* Retour */}
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-1 text-muted-foreground hover:text-foreground"
            onClick={retourArriere}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Retour
          </Button>

          {/* Badges */}
          <div className="flex items-center gap-2 mb-4">
              {order.urgency && order.urgency !== 'normal' && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${urgencyInfo.color}`}>
                  <UrgencyIcon className="w-3 h-3" />
                  {urgencyInfo.label}
                </span>
              )}
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border ${statusInfo.color}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {statusInfo.label}
              </span>
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
              <ShoppingCart className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Bon de commande</span>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{order.orderNumber}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Émise le {formatDate(order.orderDate)}
              </p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              { icon: <Building2 className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50", label: "Fournisseur", value: supplier?.name || "N/A" },
              { icon: <ShoppingCart className="h-4 w-4 text-green-600" />, iconBg: "bg-green-50", label: "Total TTC", value: formatCurrency(order.totalAmountTTC) },
              { icon: <Package className="h-4 w-4 text-purple-500" />, iconBg: "bg-purple-50", label: "Articles", value: `${lines.length} article${lines.length > 1 ? "s" : ""}` },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
                <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                  {kpi.icon}
                </div>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium text-gray-500">{kpi.label}</p>
                  <p className="text-[15px] font-bold text-gray-800 leading-tight mt-1 truncate">{kpi.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          DÉTAILS + FINANCIER
      ═══════════════════════════════════════════ */}
      <div className="grid gap-5 md:grid-cols-3">

        {/* Informations fournisseur & commande */}
        <Card className="md:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <ClipboardList className="w-3.5 h-3.5 text-green-600" />
              </div>
              <CardTitle className="text-base">Détails de la commande</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Fournisseur highlight */}
            <div className="rounded-xl p-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-gray-400" />
                <span className="text-[10.5px] font-bold tracking-widest uppercase text-gray-400">Fournisseur</span>
              </div>
              <p className="font-bold text-gray-900 text-[15px]" data-testid="supplier-name">{supplier?.name || "N/A"}</p>
              {supplier?.email && <p className="text-[12px] text-gray-500 mt-0.5">{supplier.email}</p>}
              {supplier?.phone && <p className="text-[12px] text-gray-500">{supplier.phone}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Créée par */}
              <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">Créée par</span>
                </div>
                <p className="font-semibold text-gray-800 text-sm">{creator?.name || "N/A"}</p>
              </div>

              {/* Date commande */}
              <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">Date commande</span>
                </div>
                <p className="font-semibold text-gray-800 text-sm">{formatDate(order.orderDate)}</p>
              </div>

              {/* Livraison prévue */}
              <div className="rounded-xl p-3" style={{ background: order.expectedDeliveryDate ? "#eff6ff" : "#f8fafc", border: `1px solid ${order.expectedDeliveryDate ? "#bfdbfe" : "#e2e8f0"}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Truck className="w-3.5 h-3.5" style={{ color: order.expectedDeliveryDate ? "#2563eb" : "#9ca3af" }} />
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: order.expectedDeliveryDate ? "#2563eb" : "#9ca3af" }}>Livraison prévue</span>
                </div>
                <p className="font-semibold text-sm" style={{ color: order.expectedDeliveryDate ? "#1e40af" : "#6b7280" }}>
                  {order.expectedDeliveryDate ? formatDate(order.expectedDeliveryDate) : "Non spécifiée"}
                </p>
              </div>

              {/* Code de livraison */}
              {order.deliveryCode && (
                <div className="rounded-xl p-3" style={{ background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-[10px] font-bold tracking-widest uppercase text-violet-500">Code de livraison</span>
                  </div>
                  <p className="font-bold text-violet-700 text-sm font-mono" data-testid="delivery-code">{order.deliveryCode}</p>
                </div>
              )}
            </div>

            {visibleOrderNotes && (
              <div className="rounded-xl p-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                <p className="text-[10px] font-bold tracking-widest uppercase text-amber-600 mb-1">Notes</p>
                <p className="text-sm text-amber-900 leading-relaxed" data-testid="order-notes">{visibleOrderNotes}</p>
              </div>
            )}

            {linkedInvoice ? (
              <div className="rounded-xl p-3" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-blue-600 mb-1">Facture fournisseur liée</p>
                    <p className="font-semibold text-blue-900 text-sm">{linkedInvoice.invoiceNumber}</p>
                    <p className="text-[12px] text-blue-700 mt-0.5">
                      Statut: {supplierInvoiceStatusLabel[linkedInvoice.status] || linkedInvoice.status}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-blue-200 text-blue-700 hover:bg-blue-50"
                    onClick={() => setLocation(`/procurement/invoices/${linkedInvoice.id}`)}
                  >
                    <FileText className="w-4 h-4 mr-1.5" />
                    Voir facture
                  </Button>
                </div>
              </div>
            ) : (order.status === "delivered" || order.status === "completed") ? (
              <div className="rounded-xl p-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                <p className="text-[12px] text-amber-800">
                  Commande réceptionnée, facture fournisseur en attente de génération.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Résumé financier */}
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #16a34a, #4ade80)" }} />
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <ShoppingCart className="w-3.5 h-3.5 text-green-600" />
              </div>
              <CardTitle className="text-base">Résumé financier</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
              <span className="text-sm text-gray-500">Total HT</span>
              <span className="font-medium text-gray-800">{formatCurrency(order.totalAmountHT)}</span>
            </div>

            {Number(order.discountPercentage) > 0 && (
              <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
                <span className="text-sm text-green-600">Remise ({Number(order.discountPercentage).toFixed(1)}%)</span>
                <span className="font-medium text-green-600">−{formatCurrency(order.discountAmount)}</span>
              </div>
            )}

            <div className="flex justify-between items-center py-1.5 border-b border-gray-100">
              <span className="text-sm text-gray-500">TVA (19,25%)</span>
              <span className="font-medium text-gray-800">{formatCurrency(order.vatAmount)}</span>
            </div>

            {/* Total TTC mis en valeur */}
            <div className="mt-2 rounded-xl p-4 text-center" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", border: "1px solid #86efac" }}>
              <p className="text-[10.5px] font-bold tracking-widest uppercase text-green-600 mb-1">Total TTC</p>
              <p className="font-black text-green-800 text-2xl leading-none" data-testid="total-ttc">
                {formatCurrency(order.totalAmountTTC)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════
          GESTION DU STATUT (rôles autorisés)
      ═══════════════════════════════════════════ */}
      {canManageOrderActions && (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${statusInfo.accent}, ${statusInfo.accent}88)` }} />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: statusInfo.accentBg, border: `1px solid ${statusInfo.accentBorder}` }}>
                  <StatusIcon className="w-3.5 h-3.5" style={{ color: statusInfo.accent }} />
                </div>
                <div>
                  <CardTitle className="text-base">Gestion du statut</CardTitle>
                  <CardDescription className="text-xs">{orderStatusHelp[order.status]}</CardDescription>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border ${statusInfo.color}`}>
                <StatusIcon className="w-3 h-3" />
                {statusInfo.label}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {statusActions.map((action) => (
                <Button
                  key={action.status}
                  onClick={() => handleStatusChange(action.status)}
                  disabled={updateStatusMutation.isPending}
                  data-testid={`button-status-${action.status}`}
                  className="text-white font-semibold shadow-sm"
                  style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
                >
                  <ArrowRight className="w-4 h-4 mr-1.5" />
                  {action.label}
                </Button>
              ))}
              {canRequestSupplierCancellation && (
                <Button
                  variant="outline"
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700 font-semibold"
                  onClick={() => handleStatusChange('cancellation_requested')}
                  disabled={updateStatusMutation.isPending}
                  data-testid="button-status-cancellation_requested"
                >
                  <AlertTriangle className="w-4 h-4 mr-1.5" />
                  Demander annulation fournisseur
                </Button>
              )}
              {canDirectCancelOrder && (
                <Button
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-semibold"
                  onClick={() => handleStatusChange('cancelled')}
                  disabled={updateStatusMutation.isPending}
                  data-testid="button-status-cancelled"
                >
                  <XCircle className="w-4 h-4 mr-1.5" />
                  Annuler la commande
                </Button>
              )}
              {updateStatusMutation.isPending && (
                <span className="flex items-center gap-1.5 text-sm text-gray-400">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-200 border-t-green-500 animate-spin" />
                  Mise à jour…
                </span>
              )}
            </div>

            {order.status === "delivered" && (
              <div className="rounded-xl p-3.5 bg-blue-50 border border-blue-200">
                <p className="text-sm font-semibold text-blue-900">
                  Livraison enregistrée: relais finance en cours
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  La commande sera clôturée automatiquement dès que la facture liée sera validée, approuvée et réglée.
                </p>
              </div>
            )}

            {/* Stepper */}
            <div className="rounded-xl p-4 space-y-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <p className="text-[11px] font-bold tracking-widest uppercase text-gray-400">Progression de la commande</p>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
                {workflowSteps.map((step, index) => {
                  const stepIndex      = statusProgressOrder.indexOf(step.key);
                  const isCurrentStep  = stepperStatus === step.key || (stepperStatus === 'partial' && step.key === 'delivered');
                  const isCompletedStep = currentStatusProgressIndex > stepIndex;
                  const cfg = statusConfig[step.key];

                  return (
                    <div key={step.key} className="flex items-center gap-2 flex-1">
                      <div className={`flex-1 rounded-xl p-3 transition-all ${
                        isCurrentStep   ? "shadow-sm" :
                        isCompletedStep ? "" : ""
                      }`}
                        style={
                          isCurrentStep  ? { background: cfg.accentBg, border: `1.5px solid ${cfg.accentBorder}` } :
                          isCompletedStep ? { background: "#f0fdf4", border: "1px solid #bbf7d0" } :
                                           { background: "white", border: "1px solid #e2e8f0" }
                        }
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                            style={
                              isCurrentStep   ? { background: cfg.accent, color: "white" } :
                              isCompletedStep ? { background: "#16a34a", color: "white" } :
                                               { background: "#e5e7eb", color: "#9ca3af" }
                            }>
                            {isCompletedStep ? "✓" : index + 1}
                          </span>
                          <p className="text-[11px] font-bold" style={{ color: isCurrentStep ? cfg.accent : isCompletedStep ? "#16a34a" : "#9ca3af" }}>
                            {step.title}
                          </p>
                        </div>
                        <p className="text-[11px] pl-7" style={{ color: isCurrentStep ? cfg.accent + "bb" : "#9ca3af" }}>
                          {step.subtitle}
                        </p>
                      </div>
                      {index < workflowSteps.length - 1 && (
                        <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 hidden lg:block" />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400">
                Cas particulier : si une partie seulement est reçue, le statut intermédiaire est <span className="font-semibold text-amber-600">Réception partielle</span>.
              </p>
              {order.status === "cancellation_requested" && (
                <p className="text-[11px] text-orange-700 rounded-lg px-2.5 py-2 bg-orange-50 border border-orange-200">
                  Annulation demandée au fournisseur. Prochaine action: confirmer l'annulation fournisseur ou revenir à l'étape active si le fournisseur refuse.
                </p>
              )}
            </div>

            {/* Responsabilités */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold tracking-widest uppercase text-gray-400">
                  {isPartsLinkedOrder
                    ? "Commande pièces atelier — Magasinier + Secrétaire (Admin backup)"
                    : "Commande hors pièces — Logistique / Secrétariat (Admin + Magasinier backup)"}
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {workflowActionRights.map((row) => (
                  <div key={row.action} className="rounded-lg p-3 bg-white" style={{ border: "1px solid #e2e8f0" }}>
                    <p className="text-[11px] font-bold text-gray-700 mb-1.5">{row.action}</p>
                    <div className="flex flex-wrap gap-1">
                      {row.roles.map((role) => (
                        <Badge key={`${row.action}-${role}`} variant="outline" className="text-[10.5px] bg-green-50 text-green-700 border-green-200 font-medium">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════
          TRAÇABILITÉ
      ═══════════════════════════════════════════ */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
              <History className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">Traçabilité</CardTitle>
              <CardDescription className="text-xs">Qui a demandé, créé et fait avancer la commande</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Acteurs */}
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            {[
              {
                label: "Demandeur(s)",
                value: requesters.length > 0
                  ? requesters.map((r) => `${r.name}${r.role ? ` (${roleLabel[r.role] || r.role})` : ""}`).join(", ")
                  : "Non renseigné",
              },
              { label: "Créée par",                  value: creator?.name  || "Non renseigné" },
              {
                label: "Envoyée au fournisseur par",
                value: sentByActor ? humanizeActorRole(sentByActor) : "Pas encore envoyée",
                dateLabel: sentTrace?.timestamp ? `Envoyée le ${formatDateTime(sentTrace.timestamp)}` : undefined,
              },
              {
                label: "Confirmée par",
                value: confirmedTrace?.actor ? humanizeActorRole(confirmedTrace.actor) : "Pas encore confirmée",
                dateLabel: confirmedTrace?.timestamp ? `Confirmée le ${formatDateTime(confirmedTrace.timestamp)}` : undefined,
              },
              {
                label: "Annulation demandée par",
                value: cancellationRequestedTrace?.actor ? humanizeActorRole(cancellationRequestedTrace.actor) : "Pas demandée",
                dateLabel: cancellationRequestedTrace?.timestamp ? `Demandée le ${formatDateTime(cancellationRequestedTrace.timestamp)}` : undefined,
              },
              {
                label: "Réceptionnée par",
                value: receivedTrace?.actor ? humanizeActorRole(receivedTrace.actor) : "Pas encore réceptionnée",
                dateLabel: receivedTrace?.timestamp ? `Réceptionnée le ${formatDateTime(receivedTrace.timestamp)}` : undefined,
              },
              {
                label: "Clôturée par",
                value: completedTrace?.actor ? humanizeActorRole(completedTrace.actor) : "Pas encore clôturée",
                dateLabel: completedTrace?.timestamp ? `Clôturée le ${formatDateTime(completedTrace.timestamp)}` : undefined,
              },
              {
                label: "Annulée par",
                value: cancelledTrace?.actor ? humanizeActorRole(cancelledTrace.actor) : "Pas encore annulée",
                dateLabel: cancelledTrace?.timestamp ? `Annulée le ${formatDateTime(cancelledTrace.timestamp)}` : undefined,
              },
            ].map(({ label, value, dateLabel }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">{label}</p>
                <p className="text-sm font-semibold text-gray-800">{value}</p>
                {dateLabel && (
                  <p className="text-[11px] text-gray-500 mt-1">{dateLabel}</p>
                )}
              </div>
            ))}
          </div>

          {/* Timeline historique */}
          <div className="space-y-1">
            <p className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">Historique des actions</p>
            {statusHistory.length === 0 ? (
              <p className="text-sm text-gray-400 py-3 text-center rounded-xl" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                Aucune action enregistrée pour le moment.
              </p>
            ) : (
              <div className="space-y-2">
                {statusHistory.slice().reverse().map((item, index) => {
                  const toInfo   = statusConfig[item.toStatus]   || statusConfig.draft;
                  const fromInfo = statusConfig[item.fromStatus] || statusConfig.draft;
                  return (
                    <div key={`${item.timestamp}-${item.toStatus}-${index}`}
                      className="flex items-start gap-3 rounded-xl p-3"
                      style={{ background: toInfo.accentBg, border: `1px solid ${toInfo.accentBorder}` }}
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: toInfo.accent + "20", border: `1.5px solid ${toInfo.accentBorder}` }}>
                        <toInfo.icon className="w-3.5 h-3.5" style={{ color: toInfo.accent }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-gray-800">
                          <span style={{ color: fromInfo.accent }}>{fromInfo.label}</span>
                          {" → "}
                          <span style={{ color: toInfo.accent }}>{toInfo.label}</span>
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {formatDateTime(item.timestamp)} · <span className="font-medium">{humanizeActorRole(item.actor || "Acteur non renseigné")}</span>
                          {item.deliveryCode && <span className="ml-1 font-mono text-violet-600">· BL: {item.deliveryCode}</span>}
                        </p>
                        {item.cancellationReason && (
                          <p className="text-[11px] text-orange-700 mt-1">
                            Motif annulation: <span className="font-medium">{item.cancellationReason}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════
          ARTICLES COMMANDÉS
      ═══════════════════════════════════════════ */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <Package className="w-3.5 h-3.5 text-green-600" />
            </div>
            <div>
              <CardTitle className="text-base">Articles commandés
                <span className="ml-2 text-sm font-normal text-gray-400">({lines.length})</span>
              </CardTitle>
              <CardDescription className="text-xs">Détails des articles inclus dans cette commande</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-gray-500 pl-6">Article</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Quantité</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Prix unitaire</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Total HT</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-gray-500 pr-6">Statut livraison</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const statusDisplay = getLineStatusDisplay(line.deliveryStatus, order.status);
                const lineSt        = lineStatusConfig[line.deliveryStatus] || lineStatusConfig.pending;
                return (
                  <TableRow key={line.id} data-testid={`line-${line.id}`} className="hover:bg-gray-50/50">
                    <TableCell className="pl-6 py-4">
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{line.part?.name || line.description || "Article"}</p>
                        {line.reference && (
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">Réf: {line.reference}</p>
                        )}
                        {line.requirement && (
                          <p className="text-[11px] text-gray-400 mt-0.5">Demande : {line.requirement.reason}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium text-gray-800">Qté: <span className="font-bold">{line.quantityOrdered}</span></div>
                        {line.quantityReceived > 0 && (
                          <div className="text-[11px] text-green-600 font-medium">Reçue: {line.quantityReceived}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-4 text-sm text-gray-700">{formatCurrency(line.unitPrice)}</TableCell>
                    <TableCell className="py-4">
                      <span className="font-bold text-gray-900">{formatCurrency(line.totalPrice)}</span>
                    </TableCell>
                    <TableCell className="pr-6 py-4">
                      <div className="space-y-1">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${lineSt.color}`}
                          data-testid={`line-status-${line.id}`}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lineSt.dot }} />
                          {statusDisplay.label}
                        </span>
                        <p className="text-[11px] text-gray-400 leading-snug max-w-[200px]">{statusDisplay.help}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════
          MODAL DEMANDE D'ANNULATION
      ═══════════════════════════════════════════ */}
      <Dialog
        open={showCancellationDialog}
        onOpenChange={(open) => {
          setShowCancellationDialog(open);
          if (!open) {
            setCancellationReason("");
            setPendingStatus(null);
          }
        }}
      >
        <DialogContent data-testid="dialog-cancellation-reason">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Demander annulation fournisseur
            </DialogTitle>
            <DialogDescription>
              Renseignez le motif d'annulation. Ce motif sera enregistré dans la traçabilité.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cancellation-reason" className="font-semibold">Motif d'annulation *</Label>
              <Textarea
                id="cancellation-reason"
                data-testid="input-cancellation-reason"
                placeholder="Ex: erreur de référence, délai fournisseur non acceptable, besoin annulé..."
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                className="min-h-[120px]"
              />
              <p className="text-xs text-gray-400">Champ obligatoire pour audit et justification métier.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowCancellationDialog(false); setCancellationReason(""); setPendingStatus(null); }}
              data-testid="button-cancel-cancellation-request"
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmCancellationRequest}
              disabled={!cancellationReason.trim() || updateStatusMutation.isPending}
              data-testid="button-confirm-cancellation-request"
              className="text-white"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
            >
              {updateStatusMutation.isPending ? "Envoi..." : "Envoyer la demande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════
          MODAL CODE DE LIVRAISON
      ═══════════════════════════════════════════ */}
      <Dialog open={showDeliveryDialog} onOpenChange={setShowDeliveryDialog}>
        <DialogContent data-testid="dialog-delivery-code">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-500" />
              Confirmer la livraison
            </DialogTitle>
            <DialogDescription>
              Saisissez le code ou numéro du bon de livraison pour confirmer la réception de cette commande.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="delivery-code" className="font-semibold">Code de livraison *</Label>
              <Input
                id="delivery-code"
                data-testid="input-delivery-code"
                placeholder="Ex : BL-2025-001, TRACK-12345…"
                value={deliveryCode}
                onChange={(e) => setDeliveryCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && deliveryCode.trim()) handleConfirmDelivery(); }}
                className="font-mono"
              />
              <p className="text-xs text-gray-400">Ce code servira de traçabilité pour la livraison.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowDeliveryDialog(false); setDeliveryCode(""); setPendingStatus(null); }}
              data-testid="button-cancel-delivery"
            >
              Annuler
            </Button>
            <Button
              onClick={handleConfirmDelivery}
              disabled={!deliveryCode.trim() || updateStatusMutation.isPending}
              data-testid="button-confirm-delivery"
              className="text-white"
              style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
            >
              {updateStatusMutation.isPending ? "Confirmation…" : "Confirmer la livraison"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
