import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canViewKpi } from "@shared/constants/roles";
import { KpiGrid, KpiTile } from "@/components/design-system";
import { isApiError } from "@/lib/api-error";
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
export const NO_DATA = "Aucune donnée";
export const UNAVAILABLE = "Indisponible";

export function formatRate(rate: number | null): string {
  return rate == null ? NO_VALUE : `${Math.round(rate * 1000) / 10} %`;
}

export function formatAverageCost(value: number | null): string {
  return value == null ? NO_VALUE : formatPrice(value);
}

/**
 * Un 4xx (droit, paramètre) ou un 501 (indicateur non implémenté) ne change pas
 * en réessayant : un seul essai. Les autres échecs (réseau, 5xx) sont réessayés une fois.
 */
export function shouldRetryKpi(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && ((error.status >= 400 && error.status < 500) || error.status === 501)) return false;
  return failureCount < 1;
}

type KpiState = { isLoading: boolean; isError: boolean };

/**
 * Valeur et sous-titre d'une tuile. Une erreur (dont 501) affiche « Indisponible » ;
 * « Aucune donnée » est réservé à une réponse reçue mais vide.
 */
export function kpiTileText(
  q: KpiState,
  value: ReactNode,
  subValue: string | null,
): { value: ReactNode; subValue?: string } {
  if (q.isLoading) return { value: "…" };
  if (q.isError) return { value: UNAVAILABLE };
  return { value, subValue: subValue ?? NO_DATA };
}

/** Trois tuiles KPI (T-35). Aucun seuil de couleur inventé : tuiles neutres. Taux nul affiché « — ». */
export function KpiTiles(props: { from?: string; to?: string }) {
  const { user } = useAuth();
  // Le serveur garde `/api/kpi/*` par `isManagementOrAdmin` : ne rien rendre (donc ne rien appeler) hors de ces rôles.
  if (!canViewKpi(user?.role)) return null;
  return <KpiTilesContent {...props} />;
}

function KpiTilesContent({ from, to }: { from?: string; to?: string }) {
  const range = { from, to };
  const options = { retry: shouldRetryKpi };
  const incidents = useContractQuery(KPI_INCIDENTS_PER_MONTH_PATH, incidentsPerMonthResponseSchema, range, options);
  const compliance = useContractQuery(KPI_PREVENTIVE_COMPLIANCE_PATH, preventiveComplianceResponseSchema, range, options);
  const cost = useContractQuery(KPI_AVG_COST_PER_INTERVENTION_PATH, avgCostPerInterventionResponseSchema, range, options);

  const incidentTotal = incidents.data?.reduce((sum, m) => sum + m.count, 0);

  return (
    <KpiGrid columns={3} data-testid="kpi-tiles">
      <KpiTile
        label="Pannes déclarées"
        {...kpiTileText(
          incidents,
          incidentTotal ?? NO_VALUE,
          incidents.data?.length ? `sur ${incidents.data.length} mois` : null,
        )}
      />
      <KpiTile
        label="Entretiens préventifs à l'heure"
        {...kpiTileText(
          compliance,
          formatRate(compliance.data?.rate ?? null),
          compliance.data && compliance.data.planned > 0
            ? `${compliance.data.doneOnTime} sur ${compliance.data.planned} prévus`
            : null,
        )}
      />
      <KpiTile
        label="Coût moyen par intervention"
        {...kpiTileText(
          cost,
          formatAverageCost(cost.data?.averageCost ?? null),
          cost.data && cost.data.interventions > 0 ? `${cost.data.interventions} interventions` : null,
        )}
      />
    </KpiGrid>
  );
}
