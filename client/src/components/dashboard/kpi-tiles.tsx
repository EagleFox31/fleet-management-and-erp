import { KpiGrid, KpiTile } from "@/components/design-system";
import { useContractQuery } from "@/lib/contract-query";
import { formatPrice } from "@/lib/utils";
import {
  KPI_AVG_COST_PER_INTERVENTION_PATH,
  KPI_INCIDENTS_PER_MONTH_PATH,
  KPI_PREVENTIVE_COMPLIANCE_PATH,
  avgCostPerInterventionResponseSchema,
  incidentsPerMonthResponseSchema,
  preventiveComplianceResponseSchema,
} from "@shared/contracts/kpi";

export const NO_VALUE = "—";

export function formatRate(rate: number | null): string {
  return rate == null ? NO_VALUE : `${Math.round(rate * 1000) / 10} %`;
}

export function formatAverageCost(value: number | null): string {
  return value == null ? NO_VALUE : formatPrice(value);
}

/** Trois tuiles KPI (T-35). Aucun seuil de couleur inventé : tuiles neutres. Taux nul affiché « — ». */
export function KpiTiles({ from, to }: { from?: string; to?: string }) {
  const range = { from, to };
  const incidents = useContractQuery(KPI_INCIDENTS_PER_MONTH_PATH, incidentsPerMonthResponseSchema, range);
  const compliance = useContractQuery(KPI_PREVENTIVE_COMPLIANCE_PATH, preventiveComplianceResponseSchema, range);
  const cost = useContractQuery(KPI_AVG_COST_PER_INTERVENTION_PATH, avgCostPerInterventionResponseSchema, range);

  const incidentTotal = incidents.data?.reduce((sum, m) => sum + m.count, 0);

  return (
    <KpiGrid columns={3} data-testid="kpi-tiles">
      <KpiTile
        label="Pannes déclarées"
        value={incidents.isLoading ? "…" : (incidentTotal ?? NO_VALUE)}
        subValue={incidents.data?.length ? `sur ${incidents.data.length} mois` : "Aucune donnée"}
      />
      <KpiTile
        label="Entretiens préventifs à l'heure"
        value={compliance.isLoading ? "…" : formatRate(compliance.data?.rate ?? null)}
        subValue={
          compliance.data && compliance.data.planned > 0
            ? `${compliance.data.doneOnTime} sur ${compliance.data.planned} prévus`
            : "Aucune donnée"
        }
      />
      <KpiTile
        label="Coût moyen par intervention"
        value={cost.isLoading ? "…" : formatAverageCost(cost.data?.averageCost ?? null)}
        subValue={
          cost.data && cost.data.interventions > 0 ? `${cost.data.interventions} interventions` : "Aucune donnée"
        }
      />
    </KpiGrid>
  );
}
