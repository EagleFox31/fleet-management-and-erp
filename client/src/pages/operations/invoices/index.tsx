import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  FileText,
  Filter,
  Eye,
  DollarSign,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/utils";
import { userMessageOf } from "@/lib/api-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

interface ClientInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountHT: string;
  vatAmount: string;
  amountTTC: string;
  balance: string;
  status: string;
  client?: { id: number; name: string };
  mission?: { id: number; orderNumber: string };
}

interface InvoicesResponse {
  invoices: ClientInvoice[];
  summary: {
    total: number;
    totalAmountHT: number;
    totalVAT: number;
    totalAmountTTC: number;
    totalBalance: number;
    totalPaid: number;
    pending: number;
    partial: number;
    paid: number;
    overdue: number;
  };
}

const statusConfig: Record<
  string,
  { label: string; color: string; icon: any }
> = {
  pending: {
    label: "En attente",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    icon: Clock,
  },
  partial: {
    label: "Partiel",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    icon: AlertTriangle,
  },
  paid: {
    label: "Payée",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    icon: CheckCircle,
  },
  overdue: {
    label: "En retard",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    icon: AlertTriangle,
  },
};

export default function ClientInvoicesListPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Charger les factures
  const { data, isLoading, error } = useQuery<InvoicesResponse>({
    queryKey: ["/api/billing/invoices", { status: statusFilter }],
  });

  // Échec de lecture : les zéros de repli ne sont pas des valeurs, les tuiles lisent « Indisponible ».
  const failed = data === undefined && !!error;
  const invoices = data?.invoices || [];
  const summary = data?.summary || {
    total: 0,
    totalAmountTTC: 0,
    totalPaid: 0,
    totalBalance: 0,
    pending: 0,
    paid: 0,
  };

  // Filtrer les factures par recherche
  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch =
      !searchQuery ||
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.client?.name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const formatCurrency = (amount: string | number) => {
    return formatPrice(Number(amount));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Factures Clients
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Facturation et suivi des paiements clients
          </p>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Factures
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="stat-total-invoices"
            >
              {failed ? UNAVAILABLE : summary.total}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Montant Total
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="stat-total-amount"
            >
              {failed ? UNAVAILABLE : formatCurrency(summary.totalAmountTTC)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payées</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500" data-testid="stat-paid">
              {failed ? UNAVAILABLE : summary.paid}
            </div>
            <p className="text-xs text-muted-foreground">
              {failed ? UNAVAILABLE : formatCurrency(summary.totalPaid)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Attente</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold text-orange-500"
              data-testid="stat-pending"
            >
              {failed ? UNAVAILABLE : summary.pending}
            </div>
            <p className="text-xs text-muted-foreground">
              {failed ? UNAVAILABLE : formatCurrency(summary.totalBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtres */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Input
            placeholder="Rechercher par numéro ou client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-invoices"
            className="max-w-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="pending">En attente</SelectItem>
            <SelectItem value="partial">Partiel</SelectItem>
            <SelectItem value="paid">Payée</SelectItem>
            <SelectItem value="overdue">En retard</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Liste des factures */}
      <Card>
        <CardHeader>
          <CardTitle>Factures ({failed ? UNAVAILABLE : filteredInvoices.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              Chargement...
            </div>
          ) : failed ? (
            <div
              className="text-center py-8 text-destructive-text"
              role="alert"
              data-testid="invoices-load-error"
            >
              {userMessageOf(error, "Impossible de charger les factures.")}
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Aucune facture trouvée
            </div>
          ) : (
            <div className="space-y-4">
              {filteredInvoices.map((invoice) => {
                const statusInfo =
                  statusConfig[invoice.status] || statusConfig.pending;
                const StatusIcon = statusInfo.icon;
                const balance = parseFloat(invoice.balance);

                return (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    data-testid={`invoice-item-${invoice.id}`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-3">
                        <h3
                          className="font-semibold text-gray-900 dark:text-white"
                          data-testid={`invoice-number-${invoice.id}`}
                        >
                          {invoice.invoiceNumber}
                        </h3>
                        <Badge className={statusInfo.color}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {statusInfo.label}
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span data-testid={`invoice-client-${invoice.id}`}>
                          Client: {invoice.client?.name || "N/A"}
                        </span>
                        {invoice.mission && (
                          <span>Mission: {invoice.mission.orderNumber}</span>
                        )}
                        <span>Date: {formatDate(invoice.invoiceDate)}</span>
                        <span>Échéance: {formatDate(invoice.dueDate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div
                          className="text-lg font-semibold text-gray-900 dark:text-white"
                          data-testid={`invoice-amount-${invoice.id}`}
                        >
                          {formatCurrency(invoice.amountTTC)}
                        </div>
                        {balance > 0 && (
                          <div className="text-sm text-orange-500">
                            Dû: {formatCurrency(balance)}
                          </div>
                        )}
                      </div>

                      <Link href={`/operations/invoices/${invoice.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-view-invoice-${invoice.id}`}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Voir
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
