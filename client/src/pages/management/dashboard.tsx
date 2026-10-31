import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Gauge,
  LayoutDashboard,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PremiumTabsNav,
  StatusMetricStrip,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { ManagementIndicatorsTab } from "@/components/management/management-indicators-tab";
import { MoneyFlowPanel } from "@/components/management/money-flow-panel";
import { useAuth } from "@/hooks/useAuth";
import type { ManagementDashboardResponse, ManagementPeriod } from "@shared/constants/management-dashboard";
import { KpiTiles } from "@/components/dashboard/kpi-tiles";
import { ClientRevenueChart } from "@/components/dashboard/client-revenue-chart";
import { ManagementFinancialOverview } from "@/components/management/management-financial-overview";
import { ManagementProfitabilityBento } from "@/components/management/management-profitability-bento";
import { ManagementExecutiveHero } from "@/components/management/management-executive-hero";

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

  return (
    <div className="space-y-6">
      <KpiTiles />
      {/* 1. Header & Quatuor Bento Hero Exécutif */}
      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-3xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
            <Skeleton className="h-36 w-full rounded-3xl" />
          </div>
        </div>
      ) : (
        <ManagementExecutiveHero
          data={data}
          period={period}
          onPeriodChange={setPeriod}
          userName={user?.name}
        />
      )}

      {/* 2. Navigation par Onglets Bento */}
      <Tabs defaultValue="overview" className="space-y-5">
        <PremiumTabsNav
          tabs={[
            { value: "overview", label: "Vue d'ensemble", icon: <TabIcon icon={LayoutDashboard} /> },
            { value: "money", label: "Flux d'argent", icon: <TabIcon icon={Wallet} /> },
            { value: "indicators", label: "Indicateurs", icon: <TabIcon icon={Gauge} /> },
            { value: "rankings", label: "Rentabilité", icon: <TabIcon icon={TrendingUp} /> },
          ]}
        />

        {/* Onglet 1 : Vue d'ensemble */}
        <TabsContent value="overview" className="space-y-5">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <>
              {/* Analyse Financière Visuelle Google-like */}
              <ManagementFinancialOverview data={data} />
              
              {/* Flotte Opérationnelle & Portefeuille Clients */}
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

        {/* Onglet 2 : Flux d'argent */}
        <TabsContent value="money" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
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

        {/* Onglet 3 : Indicateurs */}
        <TabsContent value="indicators" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <ManagementIndicatorsTab data={data} />
          )}
        </TabsContent>

        {/* Onglet 4 : Rentabilité */}
        <TabsContent value="rankings" className="space-y-4">
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <ManagementProfitabilityBento data={data} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
