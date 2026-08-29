import { RefreshCw, Truck } from "lucide-react";
import { KpiGrid, KpiTile } from "@/components/design-system";
import { ManagementRankingPanel } from "@/components/management/management-ranking-panel";
import { formatPrice } from "@/lib/utils";
import type { ManagementVehicleObsolescence } from "@shared/constants/management-vehicle-obsolescence";

type ManagementVehicleObsolescencePanelProps = {
  data: ManagementVehicleObsolescence;
};

function formatAgeYears(value: number): string {
  if (value < 1) return "< 1 an";
  return `${value.toFixed(0)} ans`;
}

export function ManagementVehicleObsolescencePanel({
  data,
}: ManagementVehicleObsolescencePanelProps) {
  const { summary } = data;

  if (summary.replacementCandidates === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <KpiGrid columns={2}>
        <KpiTile
          label="À remplacer"
          value={summary.replacementCandidates}
          icon={<RefreshCw className="h-4 w-4" />}
          iconWrapperClassName="bg-red-50 text-red-600"
        />
        <KpiTile
          label="Maint. annualisée"
          value={formatPrice(summary.totalAnnualizedMaintenanceHT)}
          icon={<Truck className="h-4 w-4" />}
          iconWrapperClassName="bg-amber-50 text-amber-700"
        />
      </KpiGrid>

      <ManagementRankingPanel
        title="Candidats remplacement"
        emptyLabel=""
        amountLabel="Maint. annualisée"
        amountTone="deficit"
        items={data.candidates.map((vehicle) => ({
          label: vehicle.registrationNumber,
          primary: `${vehicle.brand} ${vehicle.model} · ${formatAgeYears(vehicle.ageYears)}`,
          secondary: `Résiduel ${formatPrice(vehicle.residualValueHT)}`,
          amount: vehicle.annualizedMaintenanceHT,
        }))}
      />
    </div>
  );
}
