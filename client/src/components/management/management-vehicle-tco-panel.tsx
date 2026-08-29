import { TrendingDown, TrendingUp, Truck } from "lucide-react";
import { AlertBannerCard, KpiGrid, KpiTile } from "@/components/design-system";
import { ManagementRankingPanel } from "@/components/management/management-ranking-panel";
import { formatPrice } from "@/lib/utils";
import type { ManagementVehicleTco } from "@shared/constants/management-dashboard";

type ManagementVehicleTcoPanelProps = {
  data: ManagementVehicleTco;
};

export function ManagementVehicleTcoPanel({ data }: ManagementVehicleTcoPanelProps) {
  const { summary } = data;
  const hasFinancialActivity =
    summary.totalRevenueHT > 0 || summary.totalPeriodCostsHT > 0;
  const hasRankings = data.topByMargin.length > 0 || data.worstByMargin.length > 0;
  const showFeaturedMargin = hasFinancialActivity;

  return (
    <div className="space-y-4">
      <KpiGrid columns={3}>
        <KpiTile
          label="Camions actifs"
          value={summary.vehicleCount}
          icon={<Truck className="h-4 w-4" />}
        />
        <KpiTile
          label="CA rattaché"
          value={formatPrice(summary.totalRevenueHT)}
          icon={<TrendingUp className="h-4 w-4" />}
          iconWrapperClassName="bg-emerald-50 text-emerald-700"
        />
        <KpiTile
          label="Coûts période"
          value={formatPrice(summary.totalPeriodCostsHT)}
          icon={<TrendingDown className="h-4 w-4" />}
          iconWrapperClassName="bg-red-50 text-red-600"
        />
      </KpiGrid>

      {showFeaturedMargin ? (
        <KpiTile
          featured
          featuredTone={summary.totalPeriodMarginHT >= 0 ? "default" : "danger"}
          label="Marge opérationnelle"
          value={formatPrice(summary.totalPeriodMarginHT)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      ) : null}

      {summary.fleetInsuranceHT > 0 ? (
        <KpiTile
          label="Assurances flotte"
          value={formatPrice(summary.fleetInsuranceHT)}
          icon={<Truck className="h-4 w-4" />}
          iconWrapperClassName="bg-blue-50 text-blue-700"
        />
      ) : null}

      {hasRankings ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.topByMargin.length > 0 ? (
            <ManagementRankingPanel
              title="Meilleures marges"
              emptyLabel=""
              amountLabel="Marge HT"
              items={data.topByMargin.map((vehicle) => ({
                label: vehicle.registrationNumber,
                primary: `${vehicle.brand} ${vehicle.model}`,
                secondary: `${vehicle.missionCount} mission(s)`,
                amount: vehicle.periodMarginHT,
              }))}
            />
          ) : null}
          {data.worstByMargin.length > 0 ? (
            <ManagementRankingPanel
              title="Camions déficitaires"
              emptyLabel=""
              amountLabel="Perte HT"
              amountTone="deficit"
              items={data.worstByMargin.map((vehicle) => ({
                label: vehicle.registrationNumber,
                primary: `${vehicle.brand} ${vehicle.model}`,
                secondary: `${vehicle.missionCount} mission(s)`,
                amount: Math.abs(vehicle.periodMarginHT),
              }))}
            />
          ) : null}
        </div>
      ) : null}

      {summary.missionsWithoutRevenueAttribution > 0 ? (
        <AlertBannerCard
          variant="warning"
          title={`${summary.missionsWithoutRevenueAttribution} mission(s) sans CA ventilé`}
          description="Affectation véhicule sans facture client sur la période."
          icon={<Truck className="h-4 w-4" />}
        />
      ) : null}

      {!hasFinancialActivity && !hasRankings && summary.missionsWithoutRevenueAttribution === 0 ? (
        <AlertBannerCard
          variant="info"
          title="Pas de mouvement financier flotte sur la période"
          icon={<Truck className="h-4 w-4" />}
        />
      ) : null}
    </div>
  );
}
