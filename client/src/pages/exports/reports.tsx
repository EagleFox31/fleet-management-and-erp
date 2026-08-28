import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Package, Fuel, TrendingUp, Users, FileSpreadsheet } from "lucide-react";
import { exportsService } from "@/services/exportsService";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CLIENTS = ["MAERSK", "CNPCC", "AGL", "SODECOTON"];

export default function ReportsCenter() {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const handleExport = async (exportFn: () => Promise<void>, exportName: string) => {
    setIsExporting(exportName);
    try {
      await exportFn();
      toast({
        title: "Export réussi",
        description: `Le fichier ${exportName} a été téléchargé`,
      });
    } catch (error) {
      toast({
        title: "Erreur d'export",
        description: "Impossible de générer le fichier Excel",
        variant: "destructive",
      });
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Centre d'Export & Rapports"
        subtitle="Exports Excel et rapports comptables"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Factures Fournisseurs
            </CardTitle>
            <CardDescription>96 factures importées</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => handleExport(
                () => exportsService.downloadSupplierInvoices(),
                "factures_fournisseurs.xlsx"
              )}
              disabled={isExporting === "supplier-invoices"}
              data-testid="export-supplier-invoices"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting === "supplier-invoices" ? "Export en cours..." : "Télécharger Excel"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-600" />
              Inventaire Stock
            </CardTitle>
            <CardDescription>58 pièces - 94.4M FCFA</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => handleExport(
                () => exportsService.downloadInventory(),
                "inventaire_stock.xlsx"
              )}
              disabled={isExporting === "inventory"}
              data-testid="export-inventory"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting === "inventory" ? "Export en cours..." : "Télécharger Excel"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fuel className="h-5 w-5 text-green-600" />
              Carburant
            </CardTitle>
            <CardDescription>Consommation mensuelle</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => handleExport(
                () => exportsService.downloadFuel({ year: currentYear, month: currentMonth }),
                `carburant_${currentMonth}_${currentYear}.xlsx`
              )}
              disabled={isExporting === "fuel"}
              data-testid="export-fuel"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting === "fuel" ? "Export en cours..." : "Télécharger Excel"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-orange-600" />
              Statistiques Carburant
            </CardTitle>
            <CardDescription>Analyse détaillée</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => handleExport(
                () => exportsService.downloadFuelStatistics({ year: currentYear, month: currentMonth }),
                `stats_carburant_${currentMonth}_${currentYear}.xlsx`
              )}
              disabled={isExporting === "fuel-stats"}
              data-testid="export-fuel-stats"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting === "fuel-stats" ? "Export en cours..." : "Télécharger Excel"}
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Missions & Factures Clients
            </CardTitle>
            <CardDescription>Export par client ou tous les clients</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {CLIENTS.map((client) => (
                  <Button
                    key={client}
                    variant="outline"
                    onClick={() => handleExport(
                      () => exportsService.downloadClientMissions({ client }),
                      `missions_${client}.xlsx`
                    )}
                    disabled={isExporting === `client-${client}`}
                    data-testid={`export-client-${client}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {client}
                  </Button>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={() => handleExport(
                  () => exportsService.downloadClientMissions(),
                  "missions_tous_clients.xlsx"
                )}
                disabled={isExporting === "all-clients"}
                data-testid="export-all-clients"
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {isExporting === "all-clients" ? "Export en cours..." : "Tous les clients"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
