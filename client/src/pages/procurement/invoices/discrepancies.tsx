import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, FileText, Eye, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import { SUPPLIER_INVOICE_DISCREPANCIES_PATH, type DiscrepancyResult } from "@shared/contracts/supplier-invoice-discrepancies";

export default function InvoiceDiscrepanciesPage() {
  // Charger les factures avec écarts
  const { data, isLoading } = useQuery<DiscrepancyResult>({
    queryKey: [SUPPLIER_INVOICE_DISCREPANCIES_PATH],
  });

  const formatCurrency = (amount: string | number) => {
    return formatPrice(Number(amount));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const discrepancies = data?.discrepancies || [];
  const totalDiscrepancyAmount = data?.totalDiscrepancyAmount || 0;
  const averageVariance = data?.averageVariance || 0;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Écarts à Traiter</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Factures avec écarts détectés par le contrôle 3 voies
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/procurement/invoices">
            <Button variant="outline" data-testid="button-back">
              <FileText className="mr-2 h-4 w-4" />
              Toutes les Factures
            </Button>
          </Link>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Factures avec Écarts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="stat-discrepancy-count">
              {discrepancies.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Montant Total Écarts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="stat-total-variance">
              {formatCurrency(totalDiscrepancyAmount)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Écart Moyen</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="stat-avg-variance">
              {averageVariance.toFixed(2)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Liste des factures avec écarts */}
      <Card>
        <CardHeader>
          <CardTitle>Factures à Vérifier</CardTitle>
          <CardDescription>
            Ces factures présentent des écarts par rapport aux commandes d'achat
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Chargement...</div>
          ) : discrepancies.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
              <p className="text-xl font-semibold text-gray-900 dark:text-white">
                Aucun écart à traiter
              </p>
              <p className="text-gray-500 dark:text-gray-400 mt-2">
                Toutes les factures correspondent aux commandes d'achat
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {discrepancies.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between p-4 border border-orange-200 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
                  data-testid={`discrepancy-item-${invoice.id}`}
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-gray-900 dark:text-white" data-testid={`invoice-number-${invoice.id}`}>
                        {invoice.invoiceNumber}
                      </h3>
                      <Badge variant="outline" className="border-orange-500 text-orange-600">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Écart {invoice.variancePercentage}%
                      </Badge>
                      {invoice.status === 'received' && (
                        <Badge className="bg-blue-100 text-blue-800">
                          À Valider
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <span data-testid={`supplier-${invoice.id}`}>
                        Fournisseur: {invoice.supplierName}
                      </span>
                      {invoice.purchaseOrderNumber && (
                        <span>BC: {invoice.purchaseOrderNumber}</span>
                      )}
                      <span>Date: {formatDate(invoice.invoiceDate)}</span>
                      <span className="text-orange-600 font-semibold">
                        Écart: {formatCurrency(invoice.varianceAmount)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-lg font-semibold text-gray-900 dark:text-white" data-testid={`amount-${invoice.id}`}>
                        {formatCurrency(invoice.totalAmountTTC)}
                      </div>
                      <div className="text-sm text-gray-500">TTC</div>
                    </div>

                    <Link href={`/procurement/invoices/${invoice.id}`}>
                      <Button variant="outline" size="sm" data-testid={`button-view-${invoice.id}`}>
                        <Eye className="mr-2 h-4 w-4" />
                        Examiner
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Informations sur l'approbation automatique */}
      <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-700 dark:text-blue-300">
            Traitement des écarts
          </CardTitle>
          <CardDescription>
            Rappel métier pour la gestion des factures en écart
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 dark:text-gray-300">
          <ul className="list-disc list-inside space-y-2">
            <li>Les écarts nécessitent une validation manuelle selon le circuit métier.</li>
            <li>Pièces atelier: validation par Magasinier / Chef d&apos;atelier (ou Admin).</li>
            <li>Achats hors atelier: validation par Secrétaire / Logistique (ou Admin).</li>
            <li>L&apos;approbation et le paiement restent au niveau administratif.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
