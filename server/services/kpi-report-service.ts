/**
 * Rapport mensuel ou trimestriel des indicateurs de pilotage (CDC #7), exportable en Excel ou PDF.
 * Les chiffres viennent de `kpiService` (une seule définition) ; `report-export` ne fait que le rendu.
 */
import { resolveReportPeriod, type ReportPeriodKind } from "../lib/kpi-rules";
import { buildKpiReport, type KpiReportData } from "../lib/kpi-report-definition";
import { renderReport, type ReportFormat } from "../lib/report-export";
import { kpiService } from "./kpi-service";

export { buildKpiReport, type KpiReportData };

export type KpiReportQuery = { period: ReportPeriodKind; from?: string; to?: string };

export const kpiReportService = {
  async load(query: KpiReportQuery, now: Date = new Date()): Promise<KpiReportData> {
    const period = resolveReportPeriod(query.period, query, now);
    const range = { from: period.from, to: period.to };
    const [failures, preventive, cost, costByType, costByVehicle] = await Promise.all([
      kpiService.failures(range, now),
      kpiService.preventiveCompliance(range, now),
      kpiService.avgCostPerIntervention(range, now),
      kpiService.maintenanceCosts({ ...range, groupBy: "type" }, now),
      kpiService.maintenanceCosts({ ...range, groupBy: "vehicle" }, now),
    ]);
    return { period, failures, preventive, cost, costByType, costByVehicle };
  },

  /** Rapport rendu et nom de fichier proposé (sans extension). */
  async render(query: KpiReportQuery, format: ReportFormat, now: Date = new Date()) {
    const data = await this.load(query, now);
    const slug = data.period.label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return {
      buffer: renderReport(buildKpiReport(data), format),
      filename: `rapport_kpi_${query.period === "month" ? "mensuel" : "trimestriel"}_${slug}`,
    };
  },
};
