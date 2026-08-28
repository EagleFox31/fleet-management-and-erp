import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { AlertTriangle, Clock, ChevronRight, FileWarning } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface OverdueInvoice {
  id: number;
  invoiceNumber: string;
  supplierId: number;
  supplierName: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  totalAmount: string;
  balance: string;
  status: string;
}

export function OverdueInvoicesAlert() {
  const [, setLocation] = useLocation();

  const { data: overdueInvoices = [], isLoading } = useQuery<OverdueInvoice[]>({
    queryKey: ["/api/supplier-invoices/overdue"],
  });

  const totalOverdue = overdueInvoices.length;
  const totalAmountDue = overdueInvoices.reduce(
    (sum, inv) => sum + parseFloat(inv.balance || inv.totalAmount),
    0
  );

  const criticalCount = overdueInvoices.filter((inv) => inv.daysOverdue > 30).length;
  const urgentCount = overdueInvoices.filter((inv) => inv.daysOverdue > 15 && inv.daysOverdue <= 30).length;

  const topOverdue = overdueInvoices
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 3);

  const getSeverityBadge = (daysOverdue: number) => {
    if (daysOverdue > 30) {
      return <Badge variant="destructive" className="text-xs">Critique</Badge>;
    } else if (daysOverdue > 15) {
      return <Badge className="bg-orange-500 text-white text-xs">Urgent</Badge>;
    } else {
      return <Badge className="bg-amber-500 text-white text-xs">En retard</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Factures en retard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-20">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalOverdue === 0) {
    return null;
  }

  return (
    <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-900">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-500" />
            <CardTitle className="text-lg">Factures fournisseurs en retard</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalCount} critique{criticalCount > 1 ? 's' : ''}
              </Badge>
            )}
            {urgentCount > 0 && (
              <Badge className="bg-orange-500 text-white text-xs">
                {urgentCount} urgent{urgentCount > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <FileWarning className="h-4 w-4 text-orange-600 dark:text-orange-500" />
              <span className="text-xs text-muted-foreground">Total factures</span>
            </div>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-500">
              {totalOverdue}
            </p>
          </div>
          <div className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-orange-600 dark:text-orange-500" />
              <span className="text-xs text-muted-foreground">Montant dû</span>
            </div>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-500">
              {formatPrice(totalAmountDue)}
            </p>
          </div>
        </div>

        {topOverdue.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Factures les plus en retard:
            </p>
            <div className="space-y-2">
              {topOverdue.map((invoice) => (
                <div
                  key={invoice.id}
                  className="bg-card border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getSeverityBadge(invoice.daysOverdue)}
                        <span className="text-xs font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {invoice.supplierName}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-orange-600 dark:text-orange-500 font-medium">
                          {invoice.daysOverdue} jour{invoice.daysOverdue > 1 ? 's' : ''} de retard
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Dû: {formatPrice(parseFloat(invoice.balance || invoice.totalAmount))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full border-orange-300 hover:bg-orange-100 dark:border-orange-800 dark:hover:bg-orange-950/40"
          onClick={() => setLocation('/procurement/invoices')}
          data-testid="button-view-overdue-invoices"
        >
          Voir toutes les factures en retard ({totalOverdue})
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
