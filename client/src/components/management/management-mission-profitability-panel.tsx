import { AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import { AlertBannerCard, KpiGrid, KpiTile } from "@/components/design-system";
import { ManagementRankingPanel } from "@/components/management/management-ranking-panel";
import { formatPrice } from "@/lib/utils";
import type { ManagementMissionProfitability } from "@shared/constants/management-dashboard";

type ManagementMissionProfitabilityPanelProps = {
  data: ManagementMissionProfitability;
};

function formatMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    revenue: "CA manquant",
    roadExpenses: "FDR réels manquants",
    actualDistance: "km réels manquants",
  };
  return fields.map((field) => labels[field] ?? field).join(" · ");
}

export function ManagementMissionProfitabilityPanel({
  data,
}: ManagementMissionProfitabilityPanelProps) {
  const { summary } = data;

  return (
    <div className="space-y-4">
      <KpiGrid columns={4}>
        <KpiTile
          label="Missions analysées"
          value={summary.analyzedCount}
          subValue="Livrées ou en cours sur la période"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <KpiTile
          label="Missions rentables"
          value={summary.profitableCount}
          subValue="Marge HT positive"
          icon={<TrendingUp className="h-4 w-4" />}
          iconWrapperClassName="bg-emerald-50 text-emerald-700"
        />
        <KpiTile
          label="Missions déficitaires"
          value={summary.deficitCount}
          subValue="Coûts > CA facturé HT"
          icon={<TrendingDown className="h-4 w-4" />}
          iconWrapperClassName="bg-red-50 text-red-600"
        />
        <KpiTile
          featured
          featuredTone={summary.totalMarginHT >= 0 ? "default" : "danger"}
          label="Marge cumulée missions"
          value={formatPrice(summary.totalMarginHT)}
          subValue="Coûts directs — hors achats fournisseurs non rattachés"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ManagementRankingPanel
          title="Top missions — marge HT"
          emptyLabel="Aucune mission rentable sur la période."
          amountLabel="Marge HT"
          items={data.topProfitable.map((mission) => ({
            label: `${mission.orderNumber} · ${mission.clientName}`,
            primary: mission.destination,
            secondary: `CA ${formatPrice(mission.revenueHT)} · coûts ${formatPrice(mission.totalCostsHT)}`,
            amount: mission.marginHT,
          }))}
        />
        <ManagementRankingPanel
          title="Missions déficitaires — à investiguer"
          emptyLabel="Aucune mission déficitaire sur la période."
          amountLabel="Perte HT"
          amountTone="deficit"
          items={data.worstDeficit.map((mission) => ({
            label: `${mission.orderNumber} · ${mission.clientName}`,
            primary: mission.destination,
            secondary: mission.hasIncompleteCosts
              ? formatMissingFields(mission.missingFields)
              : `CA ${formatPrice(mission.revenueHT)} · coûts ${formatPrice(mission.totalCostsHT)}`,
            amount: Math.abs(mission.marginHT),
          }))}
        />
      </div>

      {summary.incompleteDataCount > 0 ? (
        <AlertBannerCard
          variant="warning"
          title={`${summary.incompleteDataCount} mission(s) avec données incomplètes`}
          description="CA, FDR réels ou km manquants — marge partielle."
          icon={<AlertCircle className="h-4 w-4" />}
        />
      ) : null}
    </div>
  );
}
