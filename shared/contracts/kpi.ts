/**
 * Indicateurs de la direction (P-10).
 *
 * Période `from` / `to` facultative ; sans période, les 12 derniers mois.
 * Montants en FCFA entiers.
 */
import { z } from "zod";
import { dateRangeQuerySchema } from "./common";

export const KPI_INCIDENTS_PER_MONTH_PATH = "/api/kpi/incidents-per-month";
export const KPI_PREVENTIVE_COMPLIANCE_PATH = "/api/kpi/preventive-compliance";
export const KPI_AVG_COST_PER_INTERVENTION_PATH = "/api/kpi/avg-cost-per-intervention";

export const kpiQuerySchema = dateRangeQuerySchema;

/** Mois `AAAA-MM`. */
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const incidentsPerMonthResponseSchema = z.array(z.object({ month: monthSchema, count: z.number().int().min(0) }));

export const preventiveComplianceResponseSchema = z.object({
  planned: z.number().int().min(0),
  doneOnTime: z.number().int().min(0),
  /** Part réalisée à temps, entre 0 et 1 ; `null` si rien n'était planifié. */
  rate: z.number().min(0).max(1).nullable(),
});

export const avgCostPerInterventionResponseSchema = z.object({
  interventions: z.number().int().min(0),
  totalCost: z.number().min(0),
  /** `null` si aucune intervention sur la période. */
  averageCost: z.number().min(0).nullable(),
});

export type KpiQuery = z.infer<typeof kpiQuerySchema>;
export type IncidentsPerMonthResponse = z.infer<typeof incidentsPerMonthResponseSchema>;
export type PreventiveComplianceResponse = z.infer<typeof preventiveComplianceResponseSchema>;
export type AvgCostPerInterventionResponse = z.infer<typeof avgCostPerInterventionResponseSchema>;
