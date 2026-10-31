/**
 * Mise en forme du rapport des indicateurs (CDC #7) : données déjà calculées -> sections à colonnes.
 * Sans entrée-sortie, donc testable seule ; `kpi-report-service` charge les chiffres.
 */
import type {
  AvgCostPerInterventionResponse,
  FailuresResponse,
  MaintenanceCostsResponse,
  PreventiveComplianceResponse,
} from "@shared/contracts/kpi";
import type { ReportPeriod } from "./kpi-rules";
import { formatReportCell, type ReportDefinition } from "./report-export";

export type KpiReportData = {
  period: ReportPeriod;
  failures: FailuresResponse;
  preventive: PreventiveComplianceResponse;
  cost: AvgCostPerInterventionResponse;
  costByType: MaintenanceCostsResponse;
  costByVehicle: MaintenanceCostsResponse;
};

const COST_NOTE =
  "Montants en FCFA, hors taxes. Coût d'un OT clos = main-d'oeuvre (heures réelles x taux horaire en vigueur, " +
  "sinon coût saisi) + pièces utilisées. Les pneus ne sont pas comptés.";

export function buildKpiReport(data: KpiReportData): ReportDefinition {
  const { period, failures, preventive, cost, costByType, costByVehicle } = data;
  const laborNote = cost.laborValued
    ? COST_NOTE
    : `${COST_NOTE} Aucun taux horaire n'est enregistré : les heures réelles ne sont pas valorisées.`;

  return {
    title: `Rapport ${period.kind === "month" ? "mensuel" : "trimestriel"} des indicateurs - ${period.label}`,
    subtitle: `Période du ${period.from} au ${period.to}`,
    sections: [
      {
        title: "Synthèse",
        columns: [
          { header: "Indicateur", key: "label" },
          { header: "Valeur", key: "value" },
          { header: "Détail", key: "detail" },
        ],
        rows: [
          { label: "Pannes (total)", value: formatReportCell(failures.total, "integer"), detail: `sur ${failures.months} mois` },
          { label: "Pannes (moyenne mensuelle)", value: formatReportCell(failures.monthlyAverage, "decimal"), detail: "mois à zéro compris" },
          {
            label: "Préventif réalisé à temps",
            value: formatReportCell(preventive.rate, "percent"),
            detail: `${preventive.doneOnTime} sur ${preventive.planned} échéances`,
          },
          {
            label: "Préventifs en retard",
            value: formatReportCell(preventive.late ?? 0, "integer"),
            detail: `dont ${preventive.withoutWorkOrder ?? 0} sans OT, ${preventive.cancelled ?? 0} annulés`,
          },
          { label: "Interventions closes", value: formatReportCell(cost.interventions, "integer"), detail: "OT terminés dans la période" },
          { label: "Coût total (FCFA)", value: formatReportCell(cost.totalCost, "amount"), detail: `main-d'oeuvre ${cost.laborTotal ?? 0}, pièces ${cost.partsTotal ?? 0}` },
          { label: "Coût moyen par intervention (FCFA)", value: formatReportCell(cost.averageCost, "amount"), detail: `${cost.missingCostCount ?? 0} OT sans main-d'oeuvre` },
        ],
        note: laborNote,
      },
      {
        title: "Pannes par mois",
        columns: [
          { header: "Mois", key: "month" },
          { header: "Pannes", key: "count", kind: "integer" },
        ],
        rows: failures.series.map((m) => ({ month: m.month, count: m.count })),
        note: "Pannes = déclarations + ordres de travail correctifs sans déclaration (jamais comptés deux fois).",
      },
      {
        title: "Pannes par véhicule",
        columns: [
          { header: "Immatriculation", key: "registration" },
          { header: "Pannes", key: "count", kind: "integer" },
        ],
        rows: failures.byVehicle.map((v) => ({ registration: v.registrationNumber, count: v.count })),
      },
      {
        title: "Coûts par type",
        columns: [
          { header: "Type", key: "label" },
          { header: "Interventions", key: "interventions", kind: "integer" },
          { header: "Coût total", key: "total", kind: "amount" },
          { header: "Coût moyen", key: "average", kind: "amount" },
        ],
        rows: costByType.groups.map((g) => ({
          label: g.label,
          interventions: g.interventions,
          total: g.totalCost,
          average: g.averageCost,
        })),
        note: laborNote,
      },
      {
        title: "Coûts par véhicule",
        columns: [
          { header: "Immatriculation", key: "label" },
          { header: "Interventions", key: "interventions", kind: "integer" },
          { header: "Coût total", key: "total", kind: "amount" },
          { header: "Coût moyen", key: "average", kind: "amount" },
        ],
        rows: costByVehicle.groups.map((g) => ({
          label: g.label,
          interventions: g.interventions,
          total: g.totalCost,
          average: g.averageCost,
        })),
      },
    ],
  };
}
