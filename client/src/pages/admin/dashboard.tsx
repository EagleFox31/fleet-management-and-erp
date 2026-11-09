import { useQuery } from "@tanstack/react-query";
import { formatPrice, formatNumber } from "@/lib/utils";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useFuelCard } from "@/hooks/useFuelCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { KpiTiles, UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { userMessageOf } from "@/lib/api-error";
import { OverdueInvoicesAlert } from "@/components/dashboard/overdue-invoices-alert";
import { VehicleStatusPieChart } from "@/components/dashboard/vehicle-status-pie-chart";
import { TopPartsChart } from "@/components/dashboard/top-parts-chart";
import { FuelConsumptionChart } from "@/components/dashboard/fuel-consumption-chart";
import { ClientRevenueChart } from "@/components/dashboard/client-revenue-chart";
import { ExpiringDocsAlert } from "@/components/dashboard/expiring-docs-alert";
import { ExpiringCPCAlert } from "@/components/dashboard/expiring-cpc-alert";
import { OverdueOrdersAlert } from "@/components/dashboard/overdue-orders-alert";
import { UsersTable } from "@/components/dashboard/users-table";
import { RolesPieChart } from "@/components/dashboard/roles-pie-chart";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed";
import { SupplierScorecard } from "@/components/dashboard/supplier-scorecard";
import { ThreeWayMatchingStats } from "@/components/dashboard/three-way-matching-stats";
import { MonthlyReportExport } from "@/components/dashboard/monthly-report-export";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import {
  Truck,
  Users,
  ClipboardList,
  Package,
  LayoutDashboard,
  Wallet,
  Warehouse,
  CreditCard,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

export default function AdminDashboard() {
  const warehouse = useWarehouse();
  const stockValueFailed = warehouse.inventoryValue.failed;
  const reorderFailed = warehouse.reorderAlerts.failed;
  const stockValueLabel = stockValueFailed
    ? UNAVAILABLE
    : formatPrice(Number(warehouse.inventoryValue.data?.totalValue ?? 0));
  const reorderCostLabel = reorderFailed
    ? UNAVAILABLE
    : formatPrice(Number(warehouse.reorderAlerts.data?.estimatedCost ?? 0));
  const fuelCard = useFuelCard();

  useEffect(() => {
    const refreshKeys = [
      "/api/statistics/fleet",
      "/api/work-orders/statistics",
      "/api/users",
      "/api/admin/users",
      "/api/warehouse/reorder-alerts",
      "/api/parts/statistics",
      "/api/fuel-records",
      "/api/fuel-records/statistics",
      "/api/fuel-card/balance",
      "/api/supplier-invoices/overdue",
      "/api/purchase-orders/overdue",
      "/api/vehicles/expiring-docs",
      "/api/drivers/expiring-cpc",
      "/api/work-orders",
      "/api/operations/missions",
      "/api/parts/stock-movements",
    ];
    const interval = setInterval(() => {
      refreshKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  const { data: fleetStats, isLoading: fleetLoading } = useQuery<any>({
    queryKey: ["/api/statistics/fleet"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: workOrderStats } = useQuery<any>({
    queryKey: ["/api/work-orders/statistics"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: users } = useQuery<any>({
    queryKey: ["/api/users"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const operationalVehicles = Number.parseInt(fleetStats?.operational || "0", 10) || 0;
  const maintenanceVehicles = Number.parseInt(fleetStats?.maintenance || "0", 10) || 0;
  const outOfServiceVehicles = Number.parseInt(fleetStats?.outOfService || "0", 10) || 0;
  const totalVehicles = operationalVehicles + maintenanceVehicles + outOfServiceVehicles;
  const usersCount = Array.isArray(users) ? users.length : 0;
  const activeWorkOrders = Number(workOrderStats?.pending || 0) + Number(workOrderStats?.inProgress || 0);

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Administration"
        title="Dashboard Administrateur"
        subtitle="Vue d'ensemble complète du système FleetMaster 2.0"
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Live · 15s
          </span>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="admin-kpi-fleet"
            label="Véhicules actifs"
            featured // un transporteur vit du nombre de camions qui roulent
            value={`${formatNumber(operationalVehicles)} / ${formatNumber(totalVehicles)}`}
            subValue="Opérationnels / Total"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            data-testid="admin-kpi-users"
            label="Utilisateurs système"
            value={formatNumber(usersCount)}
            subValue="Comptes actifs"
            icon={<Users className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
          />
          <KpiTile
            data-testid="admin-kpi-workorders"
            label="Ordres de travail actifs"
            value={formatNumber(activeWorkOrders)}
            subValue={`${workOrderStats?.completed || 0} terminés`}
            icon={<ClipboardList className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
          {warehouse.statistics.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-3 w-24 mt-1" />
              <Skeleton className="h-5 w-20" />
            </div>
          ) : (
            <KpiTile
              data-testid="admin-kpi-parts"
              label="Pièces en stock"
              value={formatNumber(warehouse.statistics.data?.totalParts || 0)}
              subValue={`${warehouse.statistics.data?.lowStockCount || 0} alertes stock bas`}
              icon={<Package className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
          )}
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
            data-testid="admin-kpi-stock-value"
            label="Valeur stock total"
            value={stockValueLabel}
            subValue={
              stockValueFailed
                ? userMessageOf(warehouse.inventoryValue.error, "La valeur du stock est momentanément indisponible.")
                : `${warehouse.inventoryValue.data?.totalParts ?? 0} pièces`
            }
            icon={<Warehouse className="h-4 w-4" />}
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
            data-testid="admin-kpi-fuel"
            label="Solde carte carburant"
            value={formatPrice(Number(fuelCard.balance.data?.balance || 0))}
            subValue={`${Math.round(fuelCard.balance.data?.fuelBalance || 0)} litres disponibles`}
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
            data-testid="admin-kpi-alerts"
            label="Alertes réapprovisionnement"
            value={reorderFailed ? UNAVAILABLE : String(warehouse.reorderAlerts.data?.totalAlerts ?? 0)}
            subValue={
              reorderFailed
                ? userMessageOf(warehouse.reorderAlerts.error, "Les alertes de réapprovisionnement sont momentanément indisponibles.")
                : `Réappro: ${reorderCostLabel}`
            }
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
          />
        )}
      </KpiGrid>

      <Tabs defaultValue="overview">
        <div data-help-target="admin-dashboard-tabs">
        <PremiumTabsNav tabs={[
          { value: "overview", label: "Vue d'ensemble", icon: <TabIcon icon={LayoutDashboard} /> },
          { value: "financials", label: "Financier", icon: <TabIcon icon={Wallet} /> },
          { value: "users", label: "Utilisateurs", icon: <TabIcon icon={Users} /> },
        ]} />
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VehicleStatusPieChart data={fleetStats} isLoading={fleetLoading} />
            <TopPartsChart />
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Alertes & Urgences</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <OverdueInvoicesAlert />
                <OverdueOrdersAlert />
                <ExpiringDocsAlert />
                <ExpiringCPCAlert />
              </div>
            </div>
          </CardShell>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Activité récente</p>
              <RecentActivityFeed />
            </div>
          </CardShell>
        </TabsContent>

        <TabsContent value="financials" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Budget Inventaire</p>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Valeur totale stock</span>
                    <span className="text-sm font-semibold" data-testid="admin-budget-stock-value">{stockValueLabel}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm text-gray-500">Coût réapprovisionnement</span>
                    <span className="text-sm font-semibold text-orange-600" data-testid="admin-budget-reorder-cost">{reorderCostLabel}</span>
                  </div>
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Budget Carburant</p>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Solde disponible</span>
                    <span className="text-sm font-semibold">{formatPrice(Number(fuelCard.balance.data?.balance || 0))}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Total consommé</span>
                    <span className="text-sm font-semibold text-red-600">{formatPrice(Number(fuelCard.balance.data?.totalDebits || 0))}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-sm text-gray-500">Total rechargé</span>
                    <span className="text-sm font-semibold text-green-600">{formatPrice(Number(fuelCard.balance.data?.totalCredits || 0))}</span>
                  </div>
                </div>
              </div>
            </CardShell>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FuelConsumptionChart />
            <ClientRevenueChart />
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Fournisseurs & Facturation</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SupplierScorecard />
                <ThreeWayMatchingStats />
                <MonthlyReportExport />
              </div>
            </div>
          </CardShell>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <UsersTable />
            </div>
            <div className="space-y-4">
              <RolesPieChart users={users || []} isLoading={!users} />
              <CardShell>
                <div className="px-4 py-3 flex flex-col gap-2">
                  <Link href="/admin/import-backup">
                    <Button variant="outline" size="sm" className="w-full" data-testid="btn-import-data">
                      Importer des données
                    </Button>
                  </Link>
                  <Link href="/operations?tab=clients">
                    <Button variant="outline" size="sm" className="w-full gap-2" data-testid="btn-manage-clients-admin">
                      <Users className="h-4 w-4" />
                      Gérer les clients
                    </Button>
                  </Link>
                </div>
              </CardShell>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
