/**
 * Indicateurs de pilotage (P-10, chantier CDC #7).
 *
 * Période `from` / `to` facultative ; sans période, les 12 derniers mois calendaires
 * (mois en cours compris). Montants en FCFA entiers, hors taxes.
 *
 * Les trois premiers indicateurs gardent leur forme d'origine ; les champs ajoutés par le
 * chantier CDC sont facultatifs (contrat figé : ajout seulement). Rôles : `KPI_VIEWER_ROLES`.
 */
import { z } from "zod";
import { dateRangeQuerySchema, isoDateSchema } from "./common";

export const KPI_INCIDENTS_PER_MONTH_PATH = "/api/kpi/incidents-per-month";
export const KPI_PREVENTIVE_COMPLIANCE_PATH = "/api/kpi/preventive-compliance";
export const KPI_AVG_COST_PER_INTERVENTION_PATH = "/api/kpi/avg-cost-per-intervention";
/** Pannes : série mensuelle (mois à zéro compris), moyenne et ventilation par véhicule. */
export const KPI_FAILURES_PATH = "/api/kpi/failures";
/** Coût d'entretien ventilé par type (préventif / correctif) ou par véhicule. */
export const KPI_MAINTENANCE_COSTS_PATH = "/api/kpi/maintenance-costs";

export const kpiQuerySchema = dateRangeQuerySchema;

/** Mois `AAAA-MM`. */
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const incidentsPerMonthResponseSchema = z.array(z.object({ month: monthSchema, count: z.number().int().min(0) }));

export const preventiveComplianceResponseSchema = z.object({
  /** Échéances préventives échues dans la période (annulées et sans OT comprises). */
  planned: z.number().int().min(0),
  /** Clôturées au plus tard le jour d'échéance (plus la tolérance). */
  doneOnTime: z.number().int().min(0),
  /** Part réalisée à temps, entre 0 et 1 ; `null` si rien n'était échu. */
  rate: z.number().min(0).max(1).nullable(),
  /** Échéances non tenues et non annulées : clôturées en retard, encore ouvertes ou sans OT. */
  late: z.number().int().min(0).optional(),
  /** Échéances dont l'OT a été annulé (comptées non réalisées). */
  cancelled: z.number().int().min(0).optional(),
  /** Parmi `late` : planifications actives échues sans aucun OT préventif rattaché. */
  withoutWorkOrder: z.number().int().min(0).optional(),
  /** Tolérance appliquée, en jours (0 par défaut). */
  toleranceDays: z.number().int().min(0).optional(),
  /** Dernier jour pris en compte : le plus petit de `to` et de la veille (Africa/Douala). */
  periodEnd: isoDateSchema.optional(),
});

export const avgCostPerInterventionResponseSchema = z.object({
  interventions: z.number().int().min(0),
  totalCost: z.number().min(0),
  /** `null` si aucune intervention sur la période. */
  averageCost: z.number().min(0).nullable(),
  /** `false` tant qu'aucun taux horaire n'existe : les heures réelles ne sont alors pas valorisées. */
  laborValued: z.boolean().optional(),
  /** Parts main-d'oeuvre, pièces et pneus du total (`laborTotal + partsTotal + tiresTotal = totalCost`). */
  laborTotal: z.number().min(0).optional(),
  partsTotal: z.number().min(0).optional(),
  tiresTotal: z.number().min(0).optional(),
  /** OT clos de la période sans aucune main-d'oeuvre saisie ni valorisable. */
  missingCostCount: z.number().int().min(0).optional(),
});

export const failuresResponseSchema = z.object({
  /** Premier et dernier jour demandés (ou déduits). */
  from: isoDateSchema,
  to: isoDateSchema,
  /** Nombre de mois calendaires de la période (dénominateur de la moyenne). */
  months: z.number().int().min(1),
  total: z.number().int().min(0),
  /** `total / months`, deux décimales. */
  monthlyAverage: z.number().min(0),
  series: z.array(z.object({ month: monthSchema, count: z.number().int().min(0) })),
  byVehicle: z.array(
    z.object({
      vehicleId: z.number().int(),
      registrationNumber: z.string(),
      count: z.number().int().min(0),
    }),
  ),
});

export const KPI_COST_GROUPS = ["type", "vehicle"] as const;
export type KpiCostGroup = (typeof KPI_COST_GROUPS)[number];

export const maintenanceCostsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    groupBy: z.enum(KPI_COST_GROUPS).default("type"),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "La date de début doit précéder la date de fin.",
    path: ["from"],
  });

const costGroupSchema = z.object({
  /** `preventive` / `corrective` pour `groupBy=type` ; l'identifiant du véhicule sinon. */
  key: z.string(),
  label: z.string(),
  interventions: z.number().int().min(0),
  totalCost: z.number().min(0),
  averageCost: z.number().min(0).nullable(),
});

export const maintenanceCostsResponseSchema = z.object({
  groupBy: z.enum(KPI_COST_GROUPS),
  laborValued: z.boolean(),
  missingCostCount: z.number().int().min(0),
  total: z.object({
    interventions: z.number().int().min(0),
    totalCost: z.number().min(0),
    averageCost: z.number().min(0).nullable(),
  }),
  groups: z.array(costGroupSchema),
});

export type KpiQuery = z.infer<typeof kpiQuerySchema>;
export type MaintenanceCostsQuery = z.infer<typeof maintenanceCostsQuerySchema>;
export type IncidentsPerMonthResponse = z.infer<typeof incidentsPerMonthResponseSchema>;
export type PreventiveComplianceResponse = z.infer<typeof preventiveComplianceResponseSchema>;
export type AvgCostPerInterventionResponse = z.infer<typeof avgCostPerInterventionResponseSchema>;
export type FailuresResponse = z.infer<typeof failuresResponseSchema>;
export type MaintenanceCostsResponse = z.infer<typeof maintenanceCostsResponseSchema>;
export type KpiCostGroupRow = z.infer<typeof costGroupSchema>;
