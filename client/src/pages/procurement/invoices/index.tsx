import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  FileText,
  Plus,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  DollarSign,
  Upload,
  HelpCircle,
  Search,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportExcelDialog } from "@/components/procurement/import-excel-dialog";
import { ProcurementTutorialModal } from "@/components/procurement/procurement-tutorial-modal";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { userMessageOf } from "@/lib/api-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

interface SupplierInvoice {
  id: number;
  invoiceNumber: string;
  supplierId: number;
  supplierName?: string;
  invoiceDate: string;
  dueDate: string;
  totalAmountHT: string;
  totalAmountTTC: string;
  vatAmount: string;
  status: string;
  hasDiscrepancy: boolean;
  varianceAmount?: string;
  variancePercentage?: string;
  purchaseOrderNumber?: string;
  createdAt: string;
  validatedAt?: string | null;
  approvedAt?: string | null;
  paidDate?: string | null;
  isPaymentComplete?: boolean | null;
}

interface SupplierInvoiceStatistics {
  totalInvoices: number;
  totalAmountHT: string;
  totalAmountTTC: string;
  totalPaid: string;
  totalBalance: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  received: { label: "Reçue", color: "bg-blue-100 text-blue-700", icon: FileText },
  validated: { label: "Validée", color: "bg-green-100 text-green-700", icon: CheckCircle },
  approved: { label: "Approuvée", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  paid: { label: "Payée", color: "bg-indigo-100 text-indigo-700", icon: DollarSign },
  disputed: { label: "Contestée", color: "bg-red-100 text-red-700", icon: XCircle },
};

function resolveInvoiceStatus(invoice: SupplierInvoice): keyof typeof statusConfig {
  const rawStatus = String(invoice.status || "").trim().toLowerCase();

  if (rawStatus in statusConfig && rawStatus !== "received") {
    return rawStatus as keyof typeof statusConfig;
  }

  if (invoice.paidDate || invoice.isPaymentComplete) {
    return "paid";
  }

  if (invoice.approvedAt) {
    return "approved";
  }

  if (invoice.validatedAt) {
    return "validated";
  }

  return "received";
}

export default function SupplierInvoicesListPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const canCreateOrImport = ["admin", "secretary", "accountant"].includes(user?.role || "");

  const { data: rawInvoicesData, isLoading, error: listError } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/supplier-invoices", { status: statusFilter }],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data: stats, error: statsError } = useQuery<SupplierInvoiceStatistics>({
    queryKey: ["/api/supplier-invoices/statistics"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Échec de lecture : ni liste vide ni somme partielle ne tiennent lieu de valeur.
  const rawInvoices = rawInvoicesData ?? [];
  const listFailed = rawInvoicesData === undefined && !!listError;
  const statsFailed = stats === undefined && !!statsError;

  const invoices = rawInvoices.map((invoice) => ({
    ...invoice,
    status: resolveInvoiceStatus(invoice),
  }));

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = !searchQuery ||
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.supplierName?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const totalInvoices = invoices.length;
  const pendingInvoices = invoices.filter(inv => inv.status === 'received' || inv.status === 'validated').length;
  const discrepancyInvoices = invoices.filter(inv => inv.hasDiscrepancy).length;
  const totalAmountFromList = invoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmountTTC || "0"), 0);
  const totalPaidFromList = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + parseFloat(inv.totalAmountTTC || "0"), 0);
  // Les sommes viennent de /statistics. La liste ne sert de repli que pendant le chargement
  // de /statistics (jamais après un échec, ni si la liste elle-même a échoué).
  const moneyFromList = !stats && !statsFailed && !listFailed;
  const totalAmount: number | null = stats
    ? Number(stats.totalAmountTTC || "0")
    : moneyFromList ? totalAmountFromList : null;
  const totalPaidAmount: number | null = stats
    ? Number(stats.totalPaid || "0")
    : moneyFromList ? totalPaidFromList : null;
  const supplierDebtAmount: number | null = stats
    ? Number(stats.totalBalance || "0")
    : moneyFromList ? Math.max(totalAmountFromList - totalPaidFromList, 0) : null;
  const money = (amount: number | null) => (amount === null ? UNAVAILABLE : formatPrice(amount));
  const count = (n: number) => (listFailed ? UNAVAILABLE : String(n));

  const formatCurrency = (amount: string | number) => formatPrice(Number(amount));

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Approvisionnement</span>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Factures Fournisseurs</h1>
                <p className="text-sm text-gray-400 mt-0.5">Contrôle 3 voies · saisie manuelle et import Excel</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <Button variant="outline" size="sm" data-testid="button-tutorial" onClick={() => setTutorialOpen(true)}
                className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5">
                <HelpCircle className="h-3.5 w-3.5" />Guide
              </Button>
              {canCreateOrImport && (
                <Button variant="outline" size="sm" data-testid="button-import-excel" onClick={() => setImportDialogOpen(true)}
                  className="border-gray-200 text-gray-600 hover:bg-gray-50 gap-1.5">
                  <Upload className="h-3.5 w-3.5" />Importer Excel
                </Button>
              )}
              <Link href="/procurement/invoices/discrepancies">
                <Button variant="outline" size="sm" data-testid="button-view-discrepancies"
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Écarts ({count(discrepancyInvoices)})
                </Button>
              </Link>
              {canCreateOrImport && (
                <Link href="/procurement/invoices/new">
                  <Button size="sm" data-testid="button-new-invoice" className="bg-green-600 hover:bg-green-700 text-white gap-1.5">
                    <Plus className="h-3.5 w-3.5" />Nouvelle Facture
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-5 pt-5 border-t border-gray-100">
            {[
              { icon: <FileText className="h-4 w-4 text-green-600" />, iconBg: "bg-green-50", label: "Total Factures", value: count(totalInvoices), sub: "toutes périodes", testId: "stat-total-invoices" },
              { icon: <Clock className="h-4 w-4 text-amber-500" />, iconBg: "bg-amber-50", label: "En Attente", value: count(pendingInvoices), sub: "à valider", testId: "stat-pending-invoices" },
              { icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, iconBg: "bg-orange-50", label: "Avec Écarts", value: count(discrepancyInvoices), sub: "à contrôler", testId: "stat-discrepancy-invoices" },
              { icon: <DollarSign className="h-4 w-4 text-blue-500" />, iconBg: "bg-blue-50", label: "Montant Total", value: money(totalAmount), sub: "facturé", testId: "stat-total-amount" },
              { icon: <AlertTriangle className="h-4 w-4 text-red-500" />, iconBg: "bg-red-50", label: "Dette Fournisseurs", value: money(supplierDebtAmount), sub: "facturé non payé", testId: "stat-supplier-debt" },
              { icon: <CheckCircle className="h-4 w-4 text-emerald-600" />, iconBg: "bg-emerald-50", label: "Payé Fournisseurs", value: money(totalPaidAmount), sub: "déjà réglé", testId: "stat-supplier-paid" },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
                <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>{kpi.icon}</div>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium text-gray-500">{kpi.label}</p>
                  <p className="text-xl font-bold text-gray-800 leading-none mt-1" data-testid={kpi.testId}>{kpi.value}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{kpi.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Invoices table card ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
              placeholder="Rechercher par numéro ou fournisseur..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-invoices"
            />
          </div>
          <Select value={statusFilter || "all"} onValueChange={(value) => setStatusFilter(value === "all" ? "" : value)}>
            <SelectTrigger className="w-[170px] text-sm h-9 border-gray-100 bg-gray-50" data-testid="select-status-filter">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="received">Reçue</SelectItem>
              <SelectItem value="validated">Validée</SelectItem>
              <SelectItem value="approved">Approuvée</SelectItem>
              <SelectItem value="paid">Payée</SelectItem>
              <SelectItem value="disputed">Contestée</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-400 ml-auto">
            {listFailed ? UNAVAILABLE : `${filteredInvoices.length} facture${filteredInvoices.length > 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["N° Facture", "Fournisseur", "BC lié", "Date", "Échéance", "Montant TTC", "Statut", ""].map((h, i) => (
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
                      <td key={j} className="px-4 py-3.5">
                        <Skeleton className="h-4 w-full max-w-[110px] rounded-md" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : listFailed ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center" role="alert" data-testid="invoices-load-error">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <AlertTriangle className="h-9 w-9 opacity-30" />
                      <p className="text-sm font-medium">{userMessageOf(listError, "Impossible de charger les factures.")}</p>
                    </div>
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <FileText className="h-9 w-9 opacity-30" />
                      <p className="text-sm font-medium">Aucune facture trouvée</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => {
                  const statusInfo = statusConfig[invoice.status] || statusConfig.received;
                  const StatusIcon = statusInfo.icon;
                  const isOverdue = invoice.status !== 'paid' && new Date(invoice.dueDate) < new Date();

                  return (
                    <tr
                      key={invoice.id}
                      className={`group border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50/60 border-l-2 ${invoice.hasDiscrepancy ? 'border-l-orange-400 bg-orange-50/20' : 'border-l-transparent'}`}
                      data-testid={`invoice-item-${invoice.id}`}
                    >
                      {/* N° Facture */}
                      <td className="px-4 py-3.5">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-gray-600 whitespace-nowrap"
                          data-testid={`invoice-number-${invoice.id}`}>
                          {invoice.invoiceNumber}
                        </span>
                      </td>

                      {/* Fournisseur */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-medium text-gray-700" data-testid={`invoice-supplier-${invoice.id}`}>
                          {invoice.supplierName || "—"}
                        </span>
                      </td>

                      {/* BC lié */}
                      <td className="px-4 py-3.5">
                        {invoice.purchaseOrderNumber ? (
                          <span className="rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-mono text-purple-600 whitespace-nowrap">
                            {invoice.purchaseOrderNumber}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs select-none">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5">
                        <span className="text-sm text-gray-500 whitespace-nowrap flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-gray-400" />
                          {formatDate(invoice.invoiceDate)}
                        </span>
                      </td>

                      {/* Échéance */}
                      <td className="px-4 py-3.5">
                        <span className={`text-sm whitespace-nowrap ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
                          {formatDate(invoice.dueDate)}
                          {isOverdue && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />}
                        </span>
                      </td>

                      {/* Montant TTC */}
                      <td className="px-4 py-3.5">
                        <div>
                          <span className="text-sm font-bold text-gray-800 tabular-nums" data-testid={`invoice-amount-${invoice.id}`}>
                            {formatCurrency(invoice.totalAmountTTC)}
                          </span>
                          {invoice.hasDiscrepancy && invoice.variancePercentage && (
                            <div className="mt-0.5">
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-600 whitespace-nowrap">
                                écart {Number(invoice.variancePercentage).toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusInfo.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end">
                          <Link href={`/procurement/invoices/${invoice.id}`}>
                            <button className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"
                              data-testid={`button-view-invoice-${invoice.id}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </Link>
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

      <ImportExcelDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
      <ProcurementTutorialModal open={tutorialOpen} onOpenChange={setTutorialOpen} />
    </div>
  );
}
