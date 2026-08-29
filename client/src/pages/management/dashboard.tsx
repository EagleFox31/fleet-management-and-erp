import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Download,
  LayoutDashboard,
  Receipt,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertBannerCard,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumTabsNav,
  StatusMetricStrip,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { ManagementPeriodSelector } from "@/components/management/management-period-selector";
import { ManagementDashboardInfoTip } from "@/components/management/management-dashboard-info-tip";
import { MoneyFlowPanel } from "@/components/management/money-flow-panel";
import { ManagementRankingPanel } from "@/components/management/management-ranking-panel";
import { ManagementTrendBadge } from "@/components/management/management-trend-badge";
import { useAuth } from "@/hooks/useAuth";
import { exportManagementBoardPackPdf } from "@/lib/management-board-pack-pdf";
import { formatPrice } from "@/lib/utils";
import { formatManagementGreeting } from "@/lib/management-greeting";
import type { ManagementDashboardResponse, ManagementPeriod } from "@shared/constants/management-dashboard";
import { ClientRevenueChart } from "@/components/dashboard/client-revenue-chart";

export default function ManagementDashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<ManagementPeriod>("month");

  const { data, isLoading } = useQuery<ManagementDashboardResponse>({
    queryKey: ["/api/management/dashboard", { period }],
    queryFn: async () => {
      const response = await fetch(`/api/management/dashboard?period=${period}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Impossible de charger le tableau de bord Direction");
      }
      return response.json();
    },
    staleTime: 30_000,
  });

  const fleetAvailable = data?.fleet.operational ?? 0;
  const fleetTotal = data?.fleet.total ?? 0;
  const trendHint = data ? `vs ${data.trends.previousPeriodLabel.toLowerCase()}` : "";

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Direction · Pilotage"
        title={user?.name ? formatManagementGreeting(user.name) : "Tableau de bord Direction"}
        subtitle="CA facturé, charges et résultat — lecture synthétique, sans saisie opérationnelle"
        icon={<LayoutDashboard className="h-5 w-5" />}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <ManagementPeriodSelector value={period} onChange={setPeriod} />
              {!isLoading && data ? (
                <ManagementDashboardInfoTip
                  periodStart={data.periodStart}
                  periodEnd={data.periodEnd}
                  previousPeriodStart={data.previousPeriodStart}
                  previousPeriodEnd={data.previousPeriodEnd}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data}
                onClick={() => data && exportManagementBoardPackPdf(data)}
              >
                <Download className="mr-2 h-4 w-4" />
                Rapport Direction (PDF)
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href="/management/reports">Rapports Direction</Link>
              </Button>
            </div>
          </div>

          {isLoading || !data ? (
            <Skeleton className="h-10 w-full max-w-3xl" />
          ) : (
            <KpiGrid columns={4}>
              <KpiTile
                label="CA facturé (TTC)"
                value={formatPrice(data.revenue.invoicedTTC)}
                subValue={
                  <span className="flex flex-col gap-0.5">
                    <span>{data.revenue.invoiceCount} facture(s)</span>
                    <ManagementTrendBadge percent={data.trends.revenueTTC} />
                    <span className="text-[10px] text-muted-foreground">{trendHint}</span>
                  </span>
                }
                icon={<Receipt className="h-4 w-4" />}
              />
              <KpiTile
                label="Encaissé"
                value={formatPrice(data.revenue.collectedTTC)}
                subValue="Entrées réalisées"
                icon={<Banknote className="h-4 w-4" />}
                iconWrapperClassName="bg-emerald-50 text-emerald-700"
              />
              <KpiTile
                label="Charges totales"
                value={formatPrice(data.expenses.total)}
                subValue={
                  <span className="flex flex-col gap-0.5">
                    <span>Carburant + atelier + fournisseurs</span>
                    <ManagementTrendBadge
                      percent={data.trends.expensesTotal}
                      higherIsBetter={false}
                    />
                    <span className="text-[10px] text-muted-foreground">{trendHint}</span>
                  </span>
                }
                icon={<Wallet className="h-4 w-4" />}
                iconWrapperClassName="bg-red-50 text-red-600"
              />
              <KpiTile
                featured
                featuredTone={data.result.grossHT >= 0 ? "default" : "danger"}
                label="Résultat brut (HT)"
                value={formatPrice(data.result.grossHT)}
                subValue={
                  <span className="flex flex-col gap-0.5">
                    <span>Marge {data.result.marginPercent.toFixed(1)} %</span>
                    <ManagementTrendBadge percent={data.trends.grossHT} />
                    <span className="text-[10px] text-white/70">{trendHint}</span>
                  </span>
                }
                icon={<TrendingUp className="h-4 w-4" />}
              />
            </KpiGrid>
          )}
        </div>
      </HeaderCard>

      {!isLoading && data && (data.alerts.overdueInvoices > 0 || data.alerts.outOfServiceVehicles > 0) ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.alerts.overdueInvoices > 0 ? (
            <AlertBannerCard
              variant="warning"
              title={`${data.alerts.overdueInvoices} facture(s) client en retard`}
              description="Des encaissements attendus ne sont pas revenus à l'échéance."
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          ) : null}
          {data.alerts.outOfServiceVehicles > 0 ? (
            <AlertBannerCard
              variant="danger"
              title={`${data.alerts.outOfServiceVehicles} véhicule(s) hors service`}
              description="Une part de la flotte n'est pas disponible pour produire du chiffre."
              icon={<Truck className="h-4 w-4" />}
            />
          ) : null}
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <PremiumTabsNav
          tabs={[
            { value: "overview", label: "Vue d'ensemble", icon: <TabIcon icon={LayoutDashboard} /> },
            { value: "money", label: "Flux d'argent", icon: <TabIcon icon={Wallet} /> },
            { value: "rankings", label: "Rentabilité", icon: <TabIcon icon={TrendingUp} /> },
          ]}
        />

        <TabsContent value="overview" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatusMetricStrip
                items={[
                  {
                    id: "fleet-total",
                    label: "Flotte totale",
                    value: fleetTotal,
                    detail: "Camions suivis dans FleetOS",
                    icon: <Truck className="h-4 w-4" />,
                    tone: "info",
                  },
                  {
                    id: "fleet-operational",
                    label: "Opérationnels",
                    value: fleetAvailable,
                    detail: "Prêts à rouler",
                    icon: <Truck className="h-4 w-4" />,
                    tone: "success",
                  },
                  {
                    id: "fleet-maintenance",
                    label: "En maintenance",
                    value: data.fleet.maintenance,
                    detail: "Immobilisés atelier",
                    icon: <Truck className="h-4 w-4" />,
                    tone: "warning",
                  },
                  {
                    id: "fleet-oos",
                    label: "Hors service",
                    value: data.fleet.outOfService,
                    detail: "Non disponibles",
                    icon: <Truck className="h-4 w-4" />,
                    tone: "danger",
                  },
                ]}
              />
              <ClientRevenueChart />
            </>
          )}
        </TabsContent>

        <TabsContent value="money" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <MoneyFlowPanel
              revenueTTC={data.revenue.invoicedTTC}
              collectedTTC={data.revenue.collectedTTC}
              outstandingTTC={data.revenue.outstandingTTC}
              expensesTotal={data.expenses.total}
              grossHT={data.result.grossHT}
              marginPercent={data.result.marginPercent}
              expenseBreakdown={data.expenses}
            />
          )}
        </TabsContent>

        <TabsContent value="rankings" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ManagementRankingPanel
                title="Top clients — CA facturé"
                emptyLabel="Aucune facture client sur la période."
                amountLabel="Factures"
                items={data.topClients.map((client) => ({
                  label: client.clientName,
                  primary: `${client.invoiceCount} facture(s)`,
                  secondary: `Encaissé ${formatPrice(client.collectedTTC)}`,
                  amount: client.invoicedTTC,
                }))}
              />
              <ManagementRankingPanel
                title="Top marchandises — activité"
                emptyLabel="Aucune mission avec cargo sur la période."
                amountLabel="Missions"
                items={data.topCargoTypes.map((cargo) => ({
                  label: cargo.cargoLabel,
                  primary: `${cargo.missionCount} mission(s)`,
                  secondary:
                    cargo.totalWeight > 0
                      ? `${cargo.totalWeight.toFixed(1)} T · carburant ${formatPrice(cargo.fuelCost)}`
                      : `Carburant ${formatPrice(cargo.fuelCost)}`,
                  amount: cargo.missionCount,
                }))}
              />
              <ManagementRankingPanel
                title="Top destinations — lignes transport"
                emptyLabel="Aucune mission livrée sur la période."
                amountLabel="Coût carburant missions"
                items={data.topDestinations.map((destination) => ({
                  label: destination.destination,
                  primary: `${destination.missionCount} mission(s)`,
                  secondary: "Volume d'activité sur la ligne",
                  amount: destination.fuelCost,
                }))}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
