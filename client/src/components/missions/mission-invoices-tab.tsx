import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import { format } from "date-fns";
import { FileText, Eye, Download, AlertTriangle, CheckCircle, Clock } from "lucide-react";

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
  summary: any;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
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

interface MissionInvoicesTabProps {
  missionId: number;
}

export function MissionInvoicesTab({ missionId }: MissionInvoicesTabProps) {
  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: ["/api/billing/invoices"],
  });

  const invoices = data?.invoices.filter((inv: ClientInvoice) => inv.mission?.id === missionId) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">
            Aucune facture trouvée
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Cette mission n'a pas encore de factures associées.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Total Factures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invoices.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Montant Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPrice(invoices.reduce((sum: number, inv: ClientInvoice) => sum + parseFloat(inv.amountTTC), 0))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Total Payé
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatPrice(invoices.reduce((sum: number, inv: ClientInvoice) => sum + (parseFloat(inv.amountTTC) - parseFloat(inv.balance)), 0))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Solde Restant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatPrice(invoices.reduce((sum: number, inv: ClientInvoice) => sum + parseFloat(inv.balance), 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Liste des factures */}
      <Card>
        <CardHeader>
          <CardTitle>Factures de cette mission</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invoices.map((invoice: ClientInvoice) => {
              const config = statusConfig[invoice.status] || statusConfig.pending;
              const StatusIcon = config.icon;

              return (
                <div
                  key={invoice.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  data-testid={`invoice-${invoice.id}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-gray-500" />
                        <span className="font-mono font-semibold text-lg">
                          {invoice.invoiceNumber}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Date: {format(new Date(invoice.invoiceDate), "dd/MM/yyyy")}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Échéance: {format(new Date(invoice.dueDate), "dd/MM/yyyy")}
                      </div>
                    </div>
                    <Badge className={config.color}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {config.label}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Montant HT</div>
                      <div className="font-medium">{formatPrice(parseFloat(invoice.amountHT))}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">TVA</div>
                      <div className="font-medium">{formatPrice(parseFloat(invoice.vatAmount))}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Montant TTC</div>
                      <div className="font-semibold text-lg">{formatPrice(parseFloat(invoice.amountTTC))}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Solde</div>
                      <div className={`font-semibold ${parseFloat(invoice.balance) > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        {formatPrice(parseFloat(invoice.balance))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/operations/invoices/${invoice.id}`}>
                      <Button size="sm" variant="outline" data-testid={`view-invoice-${invoice.id}`}>
                        <Eye className="w-4 h-4 mr-2" />
                        Détails
                      </Button>
                    </Link>
                    <Button size="sm" variant="outline" disabled>
                      <Download className="w-4 h-4 mr-2" />
                      PDF
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
