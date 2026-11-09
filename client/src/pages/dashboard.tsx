import React, { useState } from "react";
import { KpiTiles, UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { userMessageOf } from "@/lib/api-error";
import { FleetStatusChart } from "@/components/dashboard/fleet-status-chart";
import { VehicleTable } from "@/components/vehicles/vehicle-table";
import { useQuery } from "@tanstack/react-query";
import { formatPrice, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AlertsPanel } from "@/components/alerts/alerts-panel";
import { DashboardAlertsSummary } from "@/components/dashboard/dashboard-alerts-summary";
import { FuelStatistics } from "@/components/fuel/fuel-statistics";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { exportDashboardToPDF } from "@/lib/pdf-export";
import { OnboardingWalkthrough } from "@/components/onboarding/onboarding-walkthrough";
import { MascotHelper } from "@/components/onboarding/mascot-helper";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useFuelCard } from "@/hooks/useFuelCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import {
  Truck,
  Calendar,
  ClipboardList,
  Fuel,
  LayoutDashboard,
  Package,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingDown,
  Download,
  Bell,
} from "lucide-react";

export default function Dashboard() {
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "year">("month");
  const [activeTab, setActiveTab] = useState("overview");
  const { isOnboardingActive, completeOnboarding } = useOnboarding();

  const warehouse = useWarehouse();
  const fuelCard = useFuelCard();

  const { data: fleetStats } = useQuery<any>({ queryKey: ["/api/statistics/fleet"] });
  const { data: complianceStats } = useQuery<any>({ queryKey: ["/api/statistics/maintenance-compliance"] });
  const { data: scheduledMaintenanceData, isError: scheduledError } = useQuery<any>({
    queryKey: ["/api/statistics/scheduled-maintenance", { period }],
  });
  const { data: fuelStats } = useQuery<any>({
    queryKey: ["/api/fuel-records/statistics", { period }],
  });
  const { data: workOrderStats } = useQuery<any>({ queryKey: ["/api/work-orders/statistics"] });
  const { data: fleetKPI } = useQuery<any>({ queryKey: ["/api/statistics/fleet-kpi"] });
  const { data: tireAlerts } = useQuery<any>({ queryKey: ["/api/tires/low-stock"] });

  const operationalVehicles = Number.parseInt(fleetStats?.operational || "0", 10) || 0;
  const maintenanceVehicles = Number.parseInt(fleetStats?.maintenance || "0", 10) || 0;
  const outOfServiceVehicles = Number.parseInt(fleetStats?.outOfService || "0", 10) || 0;
  const totalVehicles = operationalVehicles + maintenanceVehicles + outOfServiceVehicles;
  const scheduledCount = Number(scheduledMaintenanceData?.scheduled || 0);
  const fuelConsumedLiters = Number(fuelStats?.totalFuel || 0);
  const stockAlertsCount = Number(warehouse.reorderAlerts.data?.totalAlerts ?? 0);
  const stockValueFailed = warehouse.inventoryValue.failed;
  const reorderFailed = warehouse.reorderAlerts.failed;
  const fuelBalanceAmount = Number(fuelCard.balance.data?.balance || 0);
  const fuelCardFailed = fuelCard.balance.failed;

  const periodLabel =
    period === "week"
      ? "cette semaine"
      : period === "month"
        ? "ce mois"
        : period === "quarter"
          ? "ce trimestre"
          : "cette année";

  const handleExportDashboard = () => {
    exportDashboardToPDF({
      fleet: fleetStats,
      workOrders: workOrderStats,
      compliance: complianceStats,
      scheduled: scheduledMaintenanceData,
      fuel: fuelStats,
    });
  };

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="FleetMaster 2.0"
        title="Tableau de bord"
        subtitle="Aperçu de la flotte et de la maintenance"
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {(["week", "month", "quarter", "year"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md transition-colors",
                    period === p
                      ? "bg-white shadow-sm font-medium text-gray-900"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {p === "week" ? "Semaine" : p === "month" ? "Mois" : p === "quarter" ? "Trim." : "Année"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="gap-2 text-xs h-8" onClick={handleExportDashboard}>
              <Download className="h-3.5 w-3.5" />
              Exporter
            </Button>
          </div>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Véhicules actifs"
            featured // vue generique: la flotte disponible reste le chiffre directeur
            value={`${formatNumber(operationalVehicles)} / ${formatNumber(totalVehicles)}`}
            subValue="Opérationnels / Total"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            label="Maintenances planifiées"
            value={scheduledError ? "Indisponible" : formatNumber(scheduledCount)}
            subValue={periodLabel}
            icon={<Calendar className="h-4 w-4" />}
            iconWrapperClassName="bg-amber-50 text-amber-600"
          />
          <KpiTile
            label="Ordres de travail"
            value={formatNumber(Number(workOrderStats?.pending || 0) + Number(workOrderStats?.inProgress || 0))}
            subValue={`${workOrderStats?.completed || 0} terminés`}
            icon={<ClipboardList className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Carburant consommé"
            value={fuelConsumedLiters > 0 ? `${fuelConsumedLiters.toFixed(0)} L` : "0 L"}
            subValue={periodLabel}
            icon={<Fuel className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
        </KpiGrid>
      </HeaderCard>
      <KpiTiles />

      {/* Real-time KPIs */}
      <KpiGrid columns={3} withTopBorder={false}>
        {warehouse.inventoryValue.isLoading ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-24 mt-1" />
            <Skeleton className="h-5 w-20" />
          </div>
        ) : (
          <KpiTile
            data-testid="kpi-stock-value"
            label="Valeur stock total"
            value={stockValueFailed ? UNAVAILABLE : formatPrice(Number(warehouse.inventoryValue.data?.totalValue ?? 0))}
            subValue={
              stockValueFailed
                ? userMessageOf(warehouse.inventoryValue.error, "La valeur du stock est momentanément indisponible.")
                : `${warehouse.inventoryValue.data?.totalParts ?? 0} pièces en stock`
            }
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
          />
        )}
        {fuelCard.balance.isLoading ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-24 mt-1" />
            <Skeleton className="h-5 w-20" />
          </div>
        ) : (
          <KpiTile
            data-testid="kpi-fuel-balance"
            label="Solde carte carburant"
            value={fuelCardFailed ? UNAVAILABLE : formatPrice(fuelBalanceAmount)}
            subValue={
              fuelCardFailed
                ? userMessageOf(fuelCard.balance.error, "Le solde de la carte carburant est momentanément indisponible.")
                : `Consommé: ${formatPrice(fuelCard.balance.data?.totalDebits || 0)}`
            }
            icon={<CreditCard className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
        )}
        {warehouse.reorderAlerts.isLoading ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-24 mt-1" />
            <Skeleton className="h-5 w-20" />
          </div>
        ) : (
          <KpiTile
            data-testid="kpi-stock-alerts"
            label="Alertes réapprovisionnement"
            value={reorderFailed ? UNAVAILABLE : stockAlertsCount}
            subValue={
              reorderFailed
                ? userMessageOf(warehouse.reorderAlerts.error, "Les alertes de réapprovisionnement sont momentanément indisponibles.")
                : `Coût estimé: ${formatPrice(warehouse.reorderAlerts.data?.estimatedCost ?? 0)}`
            }
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
          />
        )}
      </KpiGrid>

      {/* CMMS Metrics */}
      {fleetKPI && (
        <CardShell topBar>
          <div className="px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Indicateurs CMMS</p>
            <TooltipProvider>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <KpiTile
                        label="Disponibilité"
                        value={`${fleetKPI.availabilityRate.toFixed(1)}%`}
                        subValue="Taux de disponibilité"
                        icon={<CheckCircle className="h-4 w-4" />}
                        iconWrapperClassName="bg-green-50 text-green-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="text-sm">
                      <strong>Taux de disponibilité :</strong> Pourcentage de véhicules opérationnels par rapport au total de la flotte.
                      <br /><br />
                      <strong>Implications :</strong><br />
                      • &gt;90% : Excellente performance<br />
                      • 70-90% : Performance acceptable<br />
                      • &lt;70% : Problèmes de maintenance à résoudre
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <KpiTile
                        label="MTBF"
                        value={`${fleetKPI.mtbf.toFixed(0)} j`}
                        subValue="Jours entre pannes"
                        icon={<Clock className="h-4 w-4" />}
                        iconWrapperClassName="bg-blue-50 text-blue-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="text-sm">
                      <strong>MTBF (Mean Time Between Failures) :</strong> Temps moyen en jours entre deux pannes pour un véhicule.
                      <br /><br />
                      <strong>Implications :</strong><br />
                      • &gt;60 jours : Excellente fiabilité<br />
                      • 30-60 jours : Fiabilité acceptable<br />
                      • &lt;30 jours : Maintenance préventive insuffisante
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <KpiTile
                        label="MTTR"
                        value={`${fleetKPI.mttr.toFixed(1)}h`}
                        subValue="Temps de réparation"
                        icon={<ClipboardList className="h-4 w-4" />}
                        iconWrapperClassName="bg-yellow-50 text-yellow-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="text-sm">
                      <strong>MTTR (Mean Time To Repair) :</strong> Temps moyen en heures pour réparer un véhicule en panne.
                      <br /><br />
                      <strong>Implications :</strong><br />
                      • &lt;4h : Réparations rapides, bon atelier<br />
                      • 4-8h : Performance standard<br />
                      • &gt;8h : Délais trop longs, optimisation nécessaire
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <KpiTile
                        label="Coût/Véhicule"
                        value={formatPrice(fleetKPI.maintenanceCostPerVehicle)}
                        subValue="Maintenance moyenne"
                        icon={<TrendingDown className="h-4 w-4" />}
                        iconWrapperClassName="bg-red-50 text-red-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="text-sm">
                      <strong>Coût de maintenance par véhicule :</strong> Dépense moyenne de maintenance par véhicule sur la période.
                      <br /><br />
                      <strong>Implications :</strong><br />
                      • Budget maîtrisé si dans les prévisions<br />
                      • Coût élevé = véhicules vieillissants ou pannes fréquentes<br />
                      • Coût faible = maintenance préventive efficace
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <KpiTile
                        label="Immobilisation"
                        value={`${fleetKPI.downtimeHours}h`}
                        subValue="Temps d'arrêt total"
                        icon={<AlertTriangle className="h-4 w-4" />}
                        iconWrapperClassName="bg-orange-50 text-orange-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="text-sm">
                      <strong>Temps d'immobilisation :</strong> Total des heures où les véhicules sont indisponibles (maintenance + hors service).
                      <br /><br />
                      <strong>Implications :</strong><br />
                      • Impact direct sur la productivité<br />
                      • Perte de revenus potentiels<br />
                      • Planification des opérations critique
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </CardShell>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <PremiumTabsNav tabs={[
          { value: "overview", label: "Aperçu général", icon: <TabIcon icon={LayoutDashboard} /> },
          { value: "fuel", label: "Carburant", icon: <TabIcon icon={Fuel} /> },
          { value: "alerts", label: "Alertes", icon: <TabIcon icon={Bell} /> },
        ]} />

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <FleetStatusChart period={period} className="lg:col-span-2" />
            <DashboardAlertsSummary />
          </div>
          <CardShell>
            <div className="p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Véhicules</p>
              <VehicleTable />
            </div>
          </CardShell>
        </TabsContent>

        <TabsContent value="fuel" className="space-y-4">
          <FuelStatistics />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <CardShell>
            <div className="p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Alertes et notifications</p>
              <AlertsPanel />
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>

      <OnboardingWalkthrough
        isOpen={isOnboardingActive}
        onClose={() => {}}
        onComplete={completeOnboarding}
      />
      <MascotHelper currentPage="dashboard" />
    </div>
  );
}
