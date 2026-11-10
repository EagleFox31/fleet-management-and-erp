import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import {
  FileText, CheckCircle, DollarSign, AlertTriangle, XCircle, Package,
  ArrowLeft, Calendar, Building2, Clock, CreditCard, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { SUPPLIER_INVOICE_PAYMENT_ROLES } from "@shared/constants/roles";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";

interface SupplierInvoiceDetails {
  invoice: {
    id: number;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmountHT: string;
    vatAmount: string;
    totalAmountTTC: string;
    status: string;
    hasDiscrepancy: boolean;
    varianceAmount: string | null;
    variancePercentage: string | null;
    notes: string | null;
    createdAt: string;
    validatedBy: number | null;
    validatedDate: string | null;
    approvedBy: number | null;
    approvedDate: string | null;
    paidBy: number | null;
    paidDate: string | null;
    paymentMethod: string | null;
    balance: string;
    workflowScope?: "parts" | "non_parts" | "none";
  };
  supplier?: { id: number; name: string; email?: string; phone?: string };
  purchaseOrder?: {
    id: number;
    orderNumber: string;
    totalAmountTTC: string;
    expectedDeliveryDate: string;
  };
  validation?: {
    hasDiscrepancy: boolean;
    variancePercentage: number;
    varianceAmount: number;
    details:
      | string
      | {
          invoiceTotal?: number;
          orderTotal?: number;
          invoiceQuantity?: number;
          orderQuantity?: number;
        };
  };
}

interface SupplierInvoiceSettlementItem {
  id: number;
  amount: string;
  paymentMethod: string;
  paymentReference: string;
  paymentDate: string;
  valueDate: string | null;
  treasuryAccount: string | null;
  proofReference: string | null;
  status: "recorded" | "reconciled" | "rejected";
  notes: string | null;
  reconciliationNote: string | null;
  recordedByUser?: { id: number; name: string; role: string } | null;
  reconciledByUser?: { id: number; name: string; role: string } | null;
  reconciledAt: string | null;
  rejectionReason?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  received: { label: "Reçue", color: "bg-blue-100 text-blue-700 border border-blue-200", icon: FileText },
  validated: { label: "Validée", color: "bg-success/15 text-success border border-success/30", icon: CheckCircle },
  approved: { label: "Approuvée", color: "bg-success/15 text-success border border-success/30", icon: CheckCircle },
  paid: { label: "Payée", color: "bg-indigo-100 text-indigo-700 border border-indigo-200", icon: DollarSign },
  disputed: { label: "Contestée", color: "bg-destructive/15 text-destructive-text border border-destructive/30", icon: XCircle },
};

const paymentMethodLabels: Record<string, string> = {
  virement: "Virement bancaire",
  cheque: "Chèque",
  especes: "Espèces",
  mobile: "Mobile Money",
  autre: "Autre",
};

export default function SupplierInvoiceDetailsPage() {
  const params = useParams();
  const invoiceId = parseInt(params.id!);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const [showValidateDialog, setShowValidateDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [validationNotes, setValidationNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState("virement");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [treasuryAccount, setTreasuryAccount] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofInputKey, setProofInputKey] = useState(0);
  const [paymentNotes, setPaymentNotes] = useState("");
  const [reconcilingSettlementId, setReconcilingSettlementId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SupplierInvoiceSettlementItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const detailQueryKey = [`/api/supplier-invoices/${invoiceId}`] as const;

  const { data: invoiceDetails, isLoading, refetch: refetchInvoiceDetails } = useQuery<SupplierInvoiceDetails>({
    queryKey: detailQueryKey,
  });

  const settlementsQueryKey = [`/api/supplier-invoices/${invoiceId}/settlements`] as const;
  const { data: settlementsData, error: settlementsError, refetch: refetchSettlements } = useQuery<SupplierInvoiceSettlementItem[]>({
    queryKey: settlementsQueryKey,
  });
  // Règlements illisibles : la liste vide de repli ferait lire « 0 en attente » et pré-remplir un montant trop élevé.
  const settlementsFailed = settlementsData === undefined && !!settlementsError;
  const settlements = settlementsData ?? [];

  const syncInvoiceCaches = (nextInvoice: any) => {
    // 1) Détail facture
    queryClient.setQueryData<SupplierInvoiceDetails | undefined>(detailQueryKey, (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        invoice: {
          ...previous.invoice,
          ...nextInvoice,
        },
      };
    });

    // 2) Listes factures (/api/supplier-invoices + variantes de filtres)
    queryClient.setQueriesData({ queryKey: ["/api/supplier-invoices"] }, (previous: any) => {
      if (!previous) return previous;
      if (Array.isArray(previous)) {
        return previous.map((item) => (item?.id === nextInvoice?.id ? { ...item, ...nextInvoice } : item));
      }
      if (Array.isArray(previous?.invoices)) {
        return {
          ...previous,
          invoices: previous.invoices.map((item: any) =>
            item?.id === nextInvoice?.id ? { ...item, ...nextInvoice } : item
          ),
        };
      }
      return previous;
    });
  };

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/supplier-invoices/${invoiceId}/validate`, { notes: validationNotes });
      return res.json();
    },
    onSuccess: async (data) => {
      if (data?.invoice) {
        syncInvoiceCaches(data.invoice);
      }
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      await refetchInvoiceDetails();
      setShowValidateDialog(false);
      setValidationNotes("");
      toast({ title: "Facture validée", description: "La facture a été validée avec succès" });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."), variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/supplier-invoices/${invoiceId}/approve`, {});
      return res.json();
    },
    onSuccess: async (data) => {
      if (data?.invoice) {
        syncInvoiceCaches(data.invoice);
      }
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      await refetchInvoiceDetails();
      toast({ title: "Facture approuvée", description: "La facture a été approuvée avec succès" });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."), variant: "destructive" });
    },
  });

  const recordSettlementMutation = useMutation({
    mutationFn: async () => {
      if (!proofFile) {
        throw new Error("Le justificatif (image/PDF) est obligatoire.");
      }

      const formData = new FormData();
      formData.append("amount", paymentAmount.replace(",", "."));
      formData.append("paymentDate", paymentDate);
      formData.append("paymentMethod", paymentMethod);
      formData.append("paymentReference", paymentReference);
      if (treasuryAccount.trim()) formData.append("treasuryAccount", treasuryAccount.trim());
      if (paymentNotes.trim()) formData.append("notes", paymentNotes.trim());
      formData.append("proofFile", proofFile);

      const res = await apiRequest("POST", `/api/supplier-invoices/${invoiceId}/settlements`, formData);
      return res.json();
    },
    onSuccess: async (data: { invoice?: any; settlement?: SupplierInvoiceSettlementItem }) => {
      if (data?.invoice) {
        syncInvoiceCaches(data.invoice);
      }
      if (data?.settlement) {
        queryClient.setQueryData<SupplierInvoiceSettlementItem[]>(settlementsQueryKey, (previous = []) => {
          const exists = previous.some((item) => item.id === data.settlement!.id);
          if (exists) {
            return previous.map((item) => (item.id === data.settlement!.id ? data.settlement! : item));
          }
          return [data.settlement!, ...previous];
        });
      }
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: settlementsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      await refetchSettlements();
      await refetchInvoiceDetails();
      setShowPaymentDialog(false);
      setPaymentReference("");
      setTreasuryAccount("");
      setProofFile(null);
      setProofInputKey((k) => k + 1);
      setPaymentNotes("");
      toast({ title: "Règlement saisi", description: "Le règlement est enregistré. Il doit être rapproché pour solder la facture." });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."), variant: "destructive" });
    },
  });

  const reconcileSettlementMutation = useMutation({
    mutationFn: async (settlementId: number) => {
      const res = await apiRequest("PATCH", `/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reconcile`, {});
      return res.json();
    },
    onMutate: (settlementId: number) => {
      setReconcilingSettlementId(settlementId);
    },
    onSuccess: async (data) => {
      if (data?.invoice) {
        syncInvoiceCaches(data.invoice);
      }
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: settlementsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      await refetchSettlements();
      await refetchInvoiceDetails();
      toast({ title: "Règlement rapproché", description: "Le rapprochement bancaire a été enregistré." });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."), variant: "destructive" });
    },
    onSettled: () => {
      setReconcilingSettlementId(null);
    },
  });
  const rejectSettlementMutation = useMutation({
    mutationFn: async ({ settlementId, reason }: { settlementId: number; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reject`, { reason });
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      queryClient.invalidateQueries({ queryKey: settlementsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      await refetchSettlements();
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Règlement rejeté", description: "Il ne compte plus dans le reste à régler." });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: userMessageOf(error, "Le rejet du règlement a échoué."), variant: "destructive" });
    },
  });
  // Double clic : disabled={isPending} ne change qu'au rendu suivant.
  const submitRejectSettlement = useSingleFlightMutate(rejectSettlementMutation.mutate);
  const submitRecordSettlement = useSingleFlightMutate(recordSettlementMutation.mutate);
  const submitReconcileSettlement = useSingleFlightMutate(reconcileSettlementMutation.mutate);

  const formatCurrency = (amount: string | number) => formatPrice(Number(amount));

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const formatDateShort = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const openSettlementDialog = (balanceValue?: string | number) => {
    const safeBalance = Math.max(Number(balanceValue || 0), 0);
    setPaymentAmount(safeBalance > 0 ? String(safeBalance) : "");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("virement");
    setPaymentReference("");
    setTreasuryAccount("");
    setProofFile(null);
    setProofInputKey((k) => k + 1);
    setPaymentNotes("");
    setShowPaymentDialog(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
          <div className="h-0.5 bg-gradient-to-r from-success to-success" />
          <div className="px-7 py-6 space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
    );
  }

  if (!invoiceDetails) {
    return (
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-card px-7 py-16 text-center text-gray-400">
        Facture introuvable
      </div>
    );
  }

  const { invoice, supplier, purchaseOrder, validation } = invoiceDetails;
  const reconciledAmount = settlements
    .filter((s) => s.status === "reconciled")
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const pendingReconciliationAmount = settlements
    .filter((s) => s.status === "recorded")
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const hasEffectiveDiscrepancy = validation?.hasDiscrepancy ?? invoice.hasDiscrepancy;
  const effectiveVariancePercentage =
    validation?.variancePercentage ?? (invoice.variancePercentage ? Number(invoice.variancePercentage) : 0);
  const effectiveVarianceAmount =
    validation?.varianceAmount ?? (invoice.varianceAmount ? Number(invoice.varianceAmount) : 0);
  const statusInfo = statusConfig[invoice.status] || statusConfig.received;
  const StatusIcon = statusInfo.icon;
  const currentRole = user?.role;
  const scope = invoice.workflowScope || "none";
  const isOverdue = invoice.status !== 'paid' && new Date(invoice.dueDate) < new Date();

  const canValidate = (() => {
    if (!currentRole) return false;
    if (scope === "parts") return ["admin", "warehouse"].includes(currentRole);
    if (scope === "non_parts") return ["admin", "secretary", "accountant", "logistics"].includes(currentRole);
    return ["admin", "secretary", "accountant"].includes(currentRole);
  })();

  const canApprove = !!currentRole && (SUPPLIER_INVOICE_PAYMENT_ROLES as readonly string[]).includes(currentRole);
  const canPay = !!currentRole && (SUPPLIER_INVOICE_PAYMENT_ROLES as readonly string[]).includes(currentRole);
  const numericBalance = Number(invoice.balance || 0);
  const remainingToRecord = Math.max(numericBalance - pendingReconciliationAmount, 0);
  const hasRecordedSettlement = settlements.some((s) => s.status === "recorded");
  // Pas de saisie sans reste dû connu : tant que les règlements ne sont pas lus, `settlements` vaut [] et le solde entier serait proposé.
  const showRecordPaymentButton = invoice.status === "approved" && canPay && settlementsData !== undefined && !settlementsFailed && remainingToRecord > 0.01;
  const showReconcileHint = invoice.status === "approved" && canPay && settlementsData !== undefined && !settlementsFailed && hasRecordedSettlement && remainingToRecord <= 0.01;

  const validationHint = scope === "parts"
    ? "Validation pièces atelier : Admin, Magasinier ou Chef d'atelier."
    : scope === "non_parts"
      ? "Validation hors atelier : Admin, Secrétaire ou Achats/Logistique."
      : "Validation administrative : Admin ou Secrétaire.";

  const hasAction = (invoice.status === 'received' && canValidate)
    || (invoice.status === 'validated' && canApprove)
    || (invoice.status === 'approved' && canPay);

  const renderValidationDetails = () => {
    if (!validation?.details) return null;
    if (typeof validation.details === "string") {
      return <p className="mt-3 text-sm text-orange-700">{validation.details}</p>;
    }

    const { invoiceTotal, orderTotal, invoiceQuantity, orderQuantity } = validation.details;
    return (
      <div className="mt-3 rounded-xl bg-card border border-orange-100 px-4 py-3 text-sm text-orange-700 space-y-1">
        <p>
          Montant facture: <span className="font-semibold">{formatCurrency(invoiceTotal || 0)}</span> •
          Commande: <span className="font-semibold">{formatCurrency(orderTotal || 0)}</span>
        </p>
        <p>
          Quantité facturée: <span className="font-semibold">{invoiceQuantity ?? 0}</span> •
          Quantité commandée: <span className="font-semibold">{orderQuantity ?? 0}</span>
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-5">

      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-card">
        <div className="h-0.5 bg-gradient-to-r from-success to-success" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          {/* Back + actions row */}
          <div className="flex items-start justify-between mb-5">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 text-muted-foreground"
              onClick={() => setLocation("/procurement/invoices")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Factures
            </Button>
            {hasAction && (
              <div className="flex gap-2">
                {invoice.status === 'received' && canValidate && (
                  <Button size="sm" onClick={() => setShowValidateDialog(true)} data-testid="button-validate"
                    className="bg-success hover:brightness-90 text-white gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" />Valider
                  </Button>
                )}
                {invoice.status === 'validated' && canApprove && (
                  <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}
                    data-testid="button-approve" className="bg-success hover:brightness-90 text-white gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" />Approuver
                  </Button>
                )}
                {showRecordPaymentButton && (
                  <Button size="sm" onClick={() => openSettlementDialog(remainingToRecord)} data-testid="button-record-payment"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
                    <DollarSign className="h-3.5 w-3.5" />Enregistrer règlement
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {statusInfo.label}
            </span>
            {hasEffectiveDiscrepancy && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-700 border border-orange-200">
                <AlertTriangle className="h-3.5 w-3.5" />
                Écart {`${Number(effectiveVariancePercentage).toFixed(2)}%`}
              </span>
            )}
            {isOverdue && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-destructive/15 text-destructive-text border border-destructive/30">
                <Clock className="h-3.5 w-3.5" />Échue
              </span>
            )}
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5 text-success" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-success">Facture fournisseur</span>
              <h1 className="text-xl font-bold text-gray-900 leading-tight" data-testid="invoice-number">
                {invoice.invoiceNumber}
              </h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {supplier?.name || "Fournisseur inconnu"}
                {supplier?.email && <span className="ml-2">· {supplier.email}</span>}
              </p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              { icon: <DollarSign className="h-4 w-4 text-gray-500" />, iconBg: "bg-gray-100", label: "Montant HT", value: formatCurrency(invoice.totalAmountHT), testId: "amount-ht" },
              { icon: <DollarSign className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50", label: "TVA", value: formatCurrency(invoice.vatAmount), testId: "amount-vat" },
              { icon: <DollarSign className="h-4 w-4 text-success" />, iconBg: "bg-success/10", label: "Total TTC", value: formatCurrency(invoice.totalAmountTTC), testId: "amount-ttc" },
              { icon: <Calendar className="h-4 w-4 text-warning-text" />, iconBg: "bg-warning/10", label: "Échéance", value: formatDateShort(invoice.dueDate), testId: "due-date" },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
                <div className={`w-7 h-7 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>{kpi.icon}</div>
                <p className="text-[11px] font-medium text-gray-500 mt-1">{kpi.label}</p>
                <p className="text-sm font-bold text-gray-800 leading-tight" data-testid={kpi.testId}>{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Discrepancy alert ── */}
      {hasEffectiveDiscrepancy && validation && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 overflow-hidden">
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <p className="text-sm font-semibold text-orange-800">Écart détecté — Contrôle 3 voies</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-card border border-orange-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-1">Écart en %</p>
                <p className="text-2xl font-bold text-orange-600">{Number(effectiveVariancePercentage).toFixed(2)}%</p>
              </div>
              <div className="rounded-xl bg-card border border-orange-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-1">Écart en montant</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(effectiveVarianceAmount)}</p>
              </div>
            </div>
            {renderValidationDetails()}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Invoice details */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <FileText className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <p className="text-sm font-semibold text-gray-800">Informations de la facture</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Date de facture", value: formatDate(invoice.invoiceDate) },
                { label: "Date d'échéance", value: formatDate(invoice.dueDate), warn: isOverdue },
                { label: "Montant HT", value: formatCurrency(invoice.totalAmountHT) },
                { label: "TVA", value: formatCurrency(invoice.vatAmount) },
              ].map((f) => (
                <div key={f.label} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{f.label}</p>
                  <p className={`text-sm font-semibold ${(f as any).warn ? 'text-destructive-text' : 'text-gray-800'}`}>{f.value}</p>
                </div>
              ))}
              <div className="col-span-2 rounded-xl bg-success/10 border border-success/20 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-1">Montant total TTC</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(invoice.totalAmountTTC)}</p>
              </div>
            </div>
            {invoice.notes && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-600">{invoice.notes}</p>
              </div>
            )}

            {/* Workflow timeline */}
            {(invoice.validatedDate || invoice.approvedDate || invoice.paidDate) && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Historique workflow</p>
                <div className="space-y-1.5">
                  {invoice.validatedDate && (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                      <span className="text-gray-600">Validée le <span className="font-medium">{formatDate(invoice.validatedDate)}</span></span>
                    </div>
                  )}
                  {invoice.approvedDate && (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                      <span className="text-gray-600">Approuvée le <span className="font-medium">{formatDate(invoice.approvedDate)}</span></span>
                    </div>
                  )}
                  {invoice.paidDate && (
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                      <span className="text-gray-600">Payée le <span className="font-medium">{formatDate(invoice.paidDate)}</span>
                        {invoice.paymentMethod && <span className="ml-1 text-gray-400">· {paymentMethodLabels[invoice.paymentMethod] || invoice.paymentMethod}</span>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions / Status sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                <CreditCard className="h-3.5 w-3.5 text-success" />
              </div>
              <p className="text-sm font-semibold text-gray-800">Actions</p>
            </div>
            <div className="p-4 space-y-3">
              {invoice.status === 'received' && canValidate && (
                <Button className="w-full bg-success hover:brightness-90 text-white gap-2" onClick={() => setShowValidateDialog(true)} data-testid="button-validate-sidebar">
                  <CheckCircle className="h-4 w-4" />Valider la facture
                </Button>
              )}
              {invoice.status === 'validated' && canApprove && (
                <Button className="w-full bg-success hover:brightness-90 text-white gap-2" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="button-approve-sidebar">
                  <CheckCircle className="h-4 w-4" />Approuver
                </Button>
              )}
              {showRecordPaymentButton && (
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2" onClick={() => openSettlementDialog(remainingToRecord)} data-testid="button-record-payment-sidebar">
                  <DollarSign className="h-4 w-4" />Enregistrer règlement
                </Button>
              )}
              {showReconcileHint && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  Règlement saisi. Effectuez le rapprochement bancaire ci-dessous pour solder la facture.
                </p>
              )}
              {invoice.status === 'paid' && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle className="h-6 w-6 text-success" />
                  </div>
                  <p className="font-semibold text-gray-800">Facture payée</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDate(invoice.paidDate)}</p>
                  {invoice.paymentMethod && (
                    <p className="text-xs text-gray-400">{paymentMethodLabels[invoice.paymentMethod] || invoice.paymentMethod}</p>
                  )}
                </div>
              )}
              {invoice.status === "received" && !canValidate && (
                <p className="text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">{validationHint}</p>
              )}
              {invoice.status === "validated" && !canApprove && (
                <p className="text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                  Approbation réservée à l&apos;administrateur ou à la secrétaire.
                </p>
              )}
              {invoice.status === "approved" && !canPay && (
                <p className="text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                  Enregistrement du règlement réservé à l&apos;administrateur ou à la secrétaire.
                </p>
              )}
            </div>
          </div>

          {/* Supplier info */}
          {supplier && (
            <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Building2 className="h-3.5 w-3.5 text-purple-500" />
                </div>
                <p className="text-sm font-semibold text-gray-800">Fournisseur</p>
              </div>
              <div className="px-5 py-4 space-y-1.5">
                <p className="text-sm font-semibold text-gray-800">{supplier.name}</p>
                {supplier.email && <p className="text-xs text-gray-400">{supplier.email}</p>}
                {supplier.phone && <p className="text-xs text-gray-400">{supplier.phone}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Purchase order linked ── */}
      {purchaseOrder && (
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Package className="h-3.5 w-3.5 text-indigo-500" />
            </div>
            <p className="text-sm font-semibold text-gray-800">Commande d'achat associée</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-3 gap-4">
            {[
              { label: "Numéro BC", value: purchaseOrder.orderNumber },
              { label: "Montant BC (TTC)", value: formatCurrency(purchaseOrder.totalAmountTTC) },
              { label: "Livraison attendue", value: formatDate(purchaseOrder.expectedDeliveryDate) },
            ].map((f) => (
              <div key={f.label} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{f.label}</p>
                <p className="text-sm font-semibold text-gray-800">{f.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Settlements (supplier payments) ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
              <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
            </div>
            <p className="text-sm font-semibold text-gray-800">Règlements fournisseurs</p>
          </div>
          {showRecordPaymentButton && (
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
              onClick={() => openSettlementDialog(remainingToRecord)}
              data-testid="button-record-settlement-inline"
            >
              <DollarSign className="h-3.5 w-3.5" />
              Enregistrer règlement
            </Button>
          )}
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Rapproché</p>
              <p className="text-sm font-bold text-success">{settlementsFailed ? UNAVAILABLE : formatCurrency(reconciledAmount)}</p>
            </div>
            <div className="rounded-xl bg-warning/10 border border-warning/20 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-warning-text mb-1">Saisi non rapproché</p>
              <p className="text-sm font-bold text-warning-text">{settlementsFailed ? UNAVAILABLE : formatCurrency(pendingReconciliationAmount)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1">Solde restant</p>
              <p className="text-sm font-bold text-blue-700">{formatCurrency(invoice.balance || 0)}</p>
            </div>
          </div>

          {settlementsFailed ? (
            <div
              className="rounded-xl border border-dashed border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-text"
              role="alert"
              data-testid="settlements-load-error"
            >
              {userMessageOf(settlementsError, "Impossible de charger les règlements.")} L'enregistrement d'un règlement est suspendu.
            </div>
          ) : settlements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              Aucun règlement saisi.
            </div>
          ) : (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Montant</th>
                    <th className="px-3 py-2">Méthode</th>
                    <th className="px-3 py-2">Référence</th>
                    <th className="px-3 py-2">Preuve</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((settlement) => {
                    const isRecorded = settlement.status === "recorded";
                    const isReconciled = settlement.status === "reconciled";
                    const isRejected = settlement.status === "rejected";
                    return (
                      <tr key={settlement.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">
                          <div>{formatDateShort(settlement.paymentDate)}</div>
                          {settlement.recordedByUser?.name && (
                            <div className="text-xs text-gray-400">Par {settlement.recordedByUser.name}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-gray-800">{formatCurrency(settlement.amount)}</td>
                        <td className="px-3 py-2 text-gray-700">{paymentMethodLabels[settlement.paymentMethod] || settlement.paymentMethod}</td>
                        <td className="px-3 py-2 text-gray-700">{settlement.paymentReference}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {settlement.proofReference ? (
                            <a
                              href={`/api/supplier-invoices/${invoiceId}/settlements/${settlement.id}/proof`}
                              className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 underline underline-offset-2 text-xs font-medium"
                              data-testid={`link-proof-${settlement.id}`}
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                              Télécharger la preuve
                            </a>
                          ) : (
                            <span className="text-xs text-destructive-text">Manquante</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isReconciled ? (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-success/15 text-success border border-success/30">
                              Rapproché
                            </span>
                          ) : isRejected ? (
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive-text border border-destructive/30"
                              title={settlement.rejectionReason ?? undefined}
                              data-testid={`badge-settlement-rejected-${settlement.id}`}
                            >
                              Rejeté
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warning/15 text-warning-text border border-warning/30">
                              Saisi
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isRecorded && canPay ? (
                            <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-destructive-text hover:text-destructive-text"
                              onClick={() => { setRejectTarget(settlement); setRejectReason(""); }}
                              data-testid={`button-reject-settlement-${settlement.id}`}
                            >
                              Rejeter
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => submitReconcileSettlement(settlement.id)}
                              disabled={reconcileSettlementMutation.isPending && reconcilingSettlementId === settlement.id}
                              data-testid={`button-reconcile-settlement-${settlement.id}`}
                            >
                              {reconcileSettlementMutation.isPending && reconcilingSettlementId === settlement.id
                                ? "Rapprochement..."
                                : "Rapprocher"}
                            </Button>
                            </div>
                          ) : isRejected && settlement.rejectionReason ? (
                            <span className="text-xs text-gray-500">{settlement.rejectionReason}</span>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {isReconciled ? "OK" : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Validate dialog */}
      <Dialog open={showValidateDialog} onOpenChange={setShowValidateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Valider la Facture</DialogTitle>
            <DialogDescription>
              Confirmer que les informations de la facture correspondent à la commande
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Notes de validation (optionnel)</Label>
              <Textarea
                value={validationNotes}
                onChange={(e) => setValidationNotes(e.target.value)}
                placeholder="Commentaires sur la validation..."
                rows={3}
                data-testid="textarea-validation-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowValidateDialog(false)}>Annuler</Button>
            <Button onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending} data-testid="button-confirm-validate">
              Confirmer la Validation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un règlement</DialogTitle>
            <DialogDescription>
              Saisir le règlement fournisseur. Le solde ne sera réduit qu'après rapprochement bancaire.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Montant du règlement (FCFA) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>
            <div>
              <Label>Date de paiement *</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} data-testid="input-payment-date" />
            </div>
            <div>
              <Label>Méthode de paiement *</Label>
              <select
                className="w-full border border-gray-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-success focus:border-success"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                data-testid="select-payment-method"
              >
                <option value="virement">Virement bancaire</option>
                <option value="cheque">Chèque</option>
                <option value="especes">Espèces</option>
                <option value="mobile">Mobile Money</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <Label>Référence de règlement *</Label>
              <Input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="N° virement / chèque / transaction"
                data-testid="input-payment-reference"
              />
            </div>
            <div>
              <Label>Compte de sortie (optionnel)</Label>
              <Input
                value={treasuryAccount}
                onChange={(e) => setTreasuryAccount(e.target.value)}
                placeholder="Ex: UBA - Compte principal"
                data-testid="input-treasury-account"
              />
            </div>
            <div>
              <Label>Justificatif (image ou PDF) *</Label>
              <Input
                key={proofInputKey}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                data-testid="input-proof-file"
              />
              <p className="text-xs text-gray-500 mt-1">
                Obligatoire. Formats acceptés: PDF, JPG, PNG, WEBP (max 8 MB).
              </p>
              {proofFile && (
                <p className="text-xs text-success mt-1">
                  Fichier sélectionné: {proofFile.name}
                </p>
              )}
            </div>
            <div>
              <Label>Notes (optionnel)</Label>
              <Textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Commentaire comptable..."
                rows={2}
                data-testid="textarea-payment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Annuler</Button>
            <Button
              onClick={() => submitRecordSettlement()}
              disabled={
                recordSettlementMutation.isPending ||
                !paymentAmount ||
                !paymentDate ||
                !paymentMethod ||
                !paymentReference.trim() ||
                !proofFile
              }
              data-testid="button-confirm-payment"
            >
              {recordSettlementMutation.isPending ? "Enregistrement..." : "Enregistrer le règlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter le règlement</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `Référence ${rejectTarget.paymentReference}, ${formatCurrency(rejectTarget.amount)}. Le règlement ne comptera plus dans le reste à régler.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Motif du rejet</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Chèque refusé, montant erroné..."
              rows={3}
              data-testid="textarea-reject-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Annuler</Button>
            <Button
              variant="destructive"
              onClick={() => rejectTarget && submitRejectSettlement({ settlementId: rejectTarget.id, reason: rejectReason.trim() })}
              disabled={rejectSettlementMutation.isPending || !rejectReason.trim()}
              data-testid="button-confirm-reject-settlement"
            >
              {rejectSettlementMutation.isPending ? "Rejet..." : "Rejeter le règlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
