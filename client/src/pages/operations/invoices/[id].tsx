import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  DollarSign,
  Download,
  FileText,
  Package,
  Phone,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { formatPrice } from "@/lib/utils";
import { CardShell, HeaderCard, KpiGrid, KpiTile, PremiumTableShell, SectionLabel } from "@/components/design-system";

interface ClientInvoiceDetails {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountHT: string;
  vatRate: string;
  vatAmount: string;
  amountTTC: string;
  balance: string;
  status: string;
  items?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  client?: {
    id: number;
    name: string;
    address?: string;
    email?: string;
    phone?: string;
  };
  mission?: {
    id: number;
    orderNumber: string;
    deliveryAddress?: string;
    deliveryDate?: string;
    plannedDeliveryDate?: string | null;
    actualDeliveryDate?: string | null;
  };
  payments?: Array<{
    id: number;
    amount: string;
    paymentDate: string;
    paymentMethod: string;
    reference?: string;
    notes?: string;
  }>;
}

const statusConfig: Record<string, { label: string; badgeClass: string }> = {
  pending: {
    label: "En attente",
    badgeClass: "bg-amber-100 text-amber-700 border border-amber-200",
  },
  partial: {
    label: "Partiellement payée",
    badgeClass: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  paid: {
    label: "Payée",
    badgeClass: "bg-green-100 text-green-700 border border-green-200",
  },
  overdue: {
    label: "En retard",
    badgeClass: "bg-red-100 text-red-700 border border-red-200",
  },
};

const paymentMethodLabel: Record<string, string> = {
  bank_transfer: "Virement bancaire",
  check: "Chèque",
  cash: "Espèces",
  mobile_money: "Mobile Money",
  other: "Autre",
};

export default function ClientInvoiceDetailsPage() {
  const params = useParams();
  const invoiceId = Number.parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const { user } = useAuth();

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const { data: invoice, isLoading } = useQuery<ClientInvoiceDetails>({
    queryKey: [`/api/billing/invoices/${invoiceId}`],
    enabled: Number.isFinite(invoiceId) && invoiceId > 0,
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/billing/invoices/${invoiceId}/payments`, {
        amount: Number.parseFloat(paymentAmount),
        paymentDate,
        paymentMethod,
        reference: paymentReference || undefined,
        notes: paymentNotes || undefined,
      });
      return res.json();
    },
    onSuccess: async (result: any) => {
      const createdPayment = result?.payment ?? null;
      const nextBalanceRaw = result?.newBalance;
      const nextStatusRaw = result?.status;

      if (createdPayment) {
        queryClient.setQueryData([`/api/billing/invoices/${invoiceId}`], (current: any) => {
          if (!current || typeof current !== "object") return current;

          const existingPayments = Array.isArray(current.payments) ? current.payments : [];
          const paymentAlreadyPresent = existingPayments.some(
            (row: any) => Number(row?.id) === Number(createdPayment?.id),
          );

          const nextPayments = paymentAlreadyPresent
            ? existingPayments
            : [createdPayment, ...existingPayments];

          const nextBalance =
            typeof nextBalanceRaw === "number" && Number.isFinite(nextBalanceRaw)
              ? nextBalanceRaw
              : Number.parseFloat(String(current.balance ?? "0"));

          const nextStatus =
            typeof nextStatusRaw === "string" && nextStatusRaw.length > 0
              ? nextStatusRaw
              : current.status;

          return {
            ...current,
            balance: String(nextBalance),
            status: nextStatus,
            payments: nextPayments,
          };
        });
      }

      queryClient.invalidateQueries({ queryKey: [`/api/billing/invoices/${invoiceId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/statistics"] });
      await queryClient.refetchQueries({
        queryKey: [`/api/billing/invoices/${invoiceId}`],
        type: "active",
      });
      await queryClient.refetchQueries({
        queryKey: ["/api/billing/invoices"],
        type: "active",
      });
      setShowPaymentDialog(false);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNotes("");
      toast({
        title: "Paiement enregistré",
        description: "Le paiement a été enregistré avec succès.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Le paiement n'a pas pu être enregistré."),
        variant: "destructive",
      });
    },
  });
  const submitPayment = useSingleFlightMutate(paymentMutation.mutate);

  const formatCurrency = (amount: string | number) => formatPrice(Number(amount || 0));

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  };

  const calculateBalanceAfterPayment = (paymentIndex: number): number => {
    if (!invoice?.payments) return 0;
    const totalAmount = Number.parseFloat(invoice.amountTTC || "0");
    const paymentsUpTo = invoice.payments.slice(0, paymentIndex + 1);
    const totalPaid = paymentsUpTo.reduce((sum, p) => sum + Number.parseFloat(p.amount || "0"), 0);
    return totalAmount - totalPaid;
  };

  const handleDownloadPDF = async () => {
    try {
      const response = await fetch(`/api/billing/invoices/${invoiceId}/pdf`);
      if (!response.ok) throw new Error("Erreur lors du téléchargement");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Facture_${invoice?.invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "PDF téléchargé",
        description: "La facture a été téléchargée avec succès.",
      });
    } catch {
      toast({
        title: "Erreur",
        description: "Impossible de télécharger le PDF.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <HeaderCard
          moduleLabel="Facturation client"
          title="Détail facture"
          subtitle="Chargement des informations..."
          icon={<FileText className="h-5 w-5" />}
        >
          <KpiGrid columns={4}>
            <Skeleton className="h-[86px] rounded-xl" />
            <Skeleton className="h-[86px] rounded-xl" />
            <Skeleton className="h-[86px] rounded-xl" />
            <Skeleton className="h-[86px] rounded-xl" />
          </KpiGrid>
        </HeaderCard>
      </div>
    );
  }

  if (!invoice) {
    return (
      <CardShell className="px-6 py-10 text-center">
        <p className="text-sm text-gray-500">Facture non trouvée.</p>
      </CardShell>
    );
  }

  const statusInfo = statusConfig[invoice.status] || statusConfig.pending;
  const balance = Number.parseFloat(invoice.balance || "0");
  const totalTTC = Number.parseFloat(invoice.amountTTC || "0");
  const paidAmount = Math.max(0, totalTTC - balance);
  const canRecordClientPayment = ["admin", "secretary", "accountant"].includes(String(user?.role || ""));
  const hasActualMissionDeliveryDate = Boolean(invoice.mission?.actualDeliveryDate);
  const missionDeliveryDateLabel = hasActualMissionDeliveryDate
    ? "Date livraison réelle"
    : "Date livraison prévue";

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Facturation client"
        title={invoice.invoiceNumber}
        subtitle={invoice.client?.name || "Client non renseigné"}
        icon={<FileText className="h-5 w-5" />}
        actions={
          <>
            <Link href="/operations?tab=invoices">
              <Button variant="outline" size="sm" className="h-9">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Retour
              </Button>
            </Link>
            <Badge className={`h-9 px-3 text-sm font-semibold ${statusInfo.badgeClass}`} data-testid="invoice-status">
              {statusInfo.label}
            </Badge>
            <Button variant="outline" onClick={handleDownloadPDF} className="h-9" data-testid="button-download-pdf">
              <Download className="h-4 w-4 mr-1.5" />
              PDF
            </Button>
          </>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Montant TTC"
            value={formatCurrency(invoice.amountTTC)}
            subValue="Facture émise"
            icon={<DollarSign className="h-4 w-4" />}
            iconWrapperClassName="bg-indigo-50 text-indigo-600"
          />
          <KpiTile
            label="Total réglé"
            value={formatCurrency(paidAmount)}
            subValue="Paiements validés"
            icon={<CheckCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName="text-green-700"
          />
          <KpiTile
            label="Solde dû"
            value={formatCurrency(balance)}
            subValue={balance > 0 ? "À encaisser" : "Soldée"}
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName={balance > 0 ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-600"}
            valueClassName={balance > 0 ? "text-amber-700" : "text-green-700"}
          />
          <KpiTile
            label="Date d'échéance"
            value={formatDate(invoice.dueDate)}
            subValue={`Émise le ${formatDate(invoice.invoiceDate)}`}
            icon={<FileText className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
        </KpiGrid>
      </HeaderCard>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <CardShell className="p-5 xl:col-span-2">
          <SectionLabel className="mb-3">Facture</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Numéro</p>
              <p className="text-lg font-bold text-gray-900 mt-1" data-testid="invoice-number-field">
                {invoice.invoiceNumber}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Date facture</p>
              <p className="text-base font-semibold text-gray-900 mt-1" data-testid="invoice-date">
                {formatDate(invoice.invoiceDate)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Date échéance</p>
              <p className="text-base font-semibold text-gray-900 mt-1" data-testid="invoice-due-date">
                {formatDate(invoice.dueDate)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Statut</p>
              <Badge className={`mt-1 ${statusInfo.badgeClass}`}>{statusInfo.label}</Badge>
            </div>
          </div>
        </CardShell>

        <CardShell className="p-5">
          <SectionLabel className="mb-3">Client</SectionLabel>
          {invoice.client ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Nom</p>
                <p className="text-base font-bold text-gray-900 mt-1" data-testid="client-name">{invoice.client.name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Adresse</p>
                <p className="text-sm text-gray-700 mt-1" data-testid="client-address">{invoice.client.address || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Email</p>
                <p className="text-sm text-gray-700 mt-1" data-testid="client-email">{invoice.client.email || "—"}</p>
              </div>
              <div className="inline-flex items-center gap-2 text-sm text-gray-700">
                <Phone className="h-4 w-4 text-gray-400" />
                <span data-testid="client-phone">{invoice.client.phone || "—"}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Aucune information client.</p>
          )}
        </CardShell>
      </div>

      {invoice.mission && (
        <CardShell className="p-5">
          <SectionLabel className="mb-3">Mission associée</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">N° mission</p>
              <p className="font-bold text-gray-900 mt-1" data-testid="mission-order-number">{invoice.mission.orderNumber}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Destination</p>
              <p className="font-semibold text-gray-900 mt-1" data-testid="mission-destination">{invoice.mission.deliveryAddress || "—"}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{missionDeliveryDateLabel}</p>
              <p className="font-semibold text-gray-900 mt-1" data-testid="mission-date">{formatDate(invoice.mission.deliveryDate)}</p>
            </div>
          </div>
        </CardShell>
      )}

      {invoice.items && invoice.items.length > 0 && (
        <PremiumTableShell
          toolbar={
            <>
              <div className="inline-flex items-center gap-2">
                <Package className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">Détails de la facture</span>
              </div>
              <span className="ml-auto text-xs text-gray-400">{invoice.items.length} ligne(s)</span>
            </>
          }
          tableContainerClassName="max-h-none"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-100">
                <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Description</th>
                <th className="text-center px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Quantité</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Prix unitaire</th>
                <th className="text-right px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr
                  key={`${item.description}-${index}`}
                  className={index % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                  data-testid={`item-row-${index}`}
                >
                  <td className="px-5 py-3.5 text-[14px] text-slate-800" data-testid={`item-description-${index}`}>{item.description}</td>
                  <td className="px-5 py-3.5 text-center font-semibold text-slate-700" data-testid={`item-quantity-${index}`}>{item.quantity}</td>
                  <td className="px-5 py-3.5 text-right text-slate-700" data-testid={`item-unit-price-${index}`}>{formatCurrency(item.unitPrice)}</td>
                  <td className="px-5 py-3.5 text-right font-bold text-slate-900" data-testid={`item-total-${index}`}>{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PremiumTableShell>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <CardShell className="p-5 xl:col-span-1">
          <SectionLabel className="mb-3">Montants</SectionLabel>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Montant HT</span>
              <span className="font-semibold text-gray-800" data-testid="amount-ht">{formatCurrency(invoice.amountHT)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">TVA ({invoice.vatRate}%)</span>
              <span className="font-semibold text-gray-800" data-testid="amount-vat">{formatCurrency(invoice.vatAmount)}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-700">Montant TTC</span>
              <span className="text-lg font-bold text-gray-900" data-testid="amount-ttc">{formatCurrency(invoice.amountTTC)}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-amber-700">Solde dû</span>
              <span className="text-lg font-bold text-amber-700" data-testid="balance-due">{formatCurrency(balance)}</span>
            </div>
          </div>
        </CardShell>

        <PremiumTableShell
          className="xl:col-span-2"
          toolbar={
            <>
              <div className="inline-flex items-center gap-2">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">Historique des paiements</span>
              </div>
              {balance > 0 && (
                <Button
                  size="sm"
                  className="ml-auto h-8"
                  variant={canRecordClientPayment ? "default" : "outline"}
                  disabled={!canRecordClientPayment}
                  title={!canRecordClientPayment ? "Réservé à l'administrateur et à la secrétaire" : undefined}
                  onClick={() => {
                    if (!canRecordClientPayment) return;
                    setShowPaymentDialog(true);
                  }}
                  data-testid="button-record-payment"
                >
                  <DollarSign className="h-4 w-4 mr-1.5" />
                  Enregistrer un paiement
                </Button>
              )}
            </>
          }
          tableContainerClassName="max-h-none"
        >
          {!invoice.payments || invoice.payments.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500" data-testid="no-payments-message">
              Aucun paiement enregistré pour cette facture.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Date</th>
                  <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Montant</th>
                  <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Mode</th>
                  <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Référence</th>
                  <th className="text-right px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Solde après</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment, index) => (
                  <tr
                    key={payment.id}
                    className={index % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                    data-testid={`payment-row-${index}`}
                  >
                    <td className="px-5 py-3.5 text-slate-700" data-testid={`payment-date-${index}`}>
                      {formatDate(payment.paymentDate)}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900" data-testid={`payment-amount-${index}`}>
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700" data-testid={`payment-method-${index}`}>
                      {paymentMethodLabel[payment.paymentMethod] || payment.paymentMethod}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700" data-testid={`payment-reference-${index}`}>
                      {payment.reference || "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-slate-900" data-testid={`payment-balance-${index}`}>
                      {formatCurrency(calculateBalanceAfterPayment(index))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PremiumTableShell>
      </div>

      <Dialog
        open={showPaymentDialog && canRecordClientPayment}
        onOpenChange={(open) => setShowPaymentDialog(canRecordClientPayment ? open : false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un paiement</DialogTitle>
            <DialogDescription>Saisissez le règlement client pour cette facture.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="payment-amount">Montant *</Label>
              <Input
                id="payment-amount"
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="Montant du paiement"
                data-testid="input-payment-amount"
              />
              {balance > 0 && <p className="text-xs text-gray-500 mt-1">Solde restant: {formatCurrency(balance)}</p>}
            </div>
            <div>
              <Label htmlFor="payment-date">Date de paiement *</Label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                data-testid="input-payment-date"
              />
            </div>
            <div>
              <Label htmlFor="payment-method">Mode de paiement *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Virement bancaire</SelectItem>
                  <SelectItem value="check">Chèque</SelectItem>
                  <SelectItem value="cash">Espèces</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payment-reference">Référence (optionnel)</Label>
              <Input
                id="payment-reference"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Numéro de transaction, chèque..."
                data-testid="input-payment-reference"
              />
            </div>
            <div>
              <Label htmlFor="payment-notes">Notes (optionnel)</Label>
              <Textarea
                id="payment-notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Informations complémentaires..."
                rows={3}
                data-testid="textarea-payment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => submitPayment()}
              disabled={paymentMutation.isPending || !paymentAmount || !paymentDate}
              data-testid="button-confirm-payment"
            >
              {paymentMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
