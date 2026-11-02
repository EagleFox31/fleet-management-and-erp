/**
 * Taux horaire HT de la main-d'oeuvre de l'atelier, daté (CDC #7).
 *
 * Un taux par date d'effet ; le taux d'une intervention est celui en vigueur le jour de sa
 * clôture (plus grande date d'effet inférieure ou égale). Aucune valeur semée : tant qu'aucun
 * taux n'existe, les indicateurs de coût ne valorisent pas les heures (`laborValued: false`).
 * Montants en FCFA, hors taxes. Un taux se crée, ne se corrige pas : un second taux à la même
 * date reçoit 409.
 */
import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common";

export const WORKSHOP_LABOR_RATES_PATH = "/api/workshop-labor-rates";

export const workshopLaborRateSchema = z.object({
  id: z.number().int(),
  effectiveFrom: isoDateSchema,
  hourlyRateHt: z.number().min(0),
  createdBy: z.number().int().nullable(),
  createdAt: isoDateTimeSchema.nullable(),
});

export const createWorkshopLaborRateRequestSchema = z.object({
  effectiveFrom: isoDateSchema,
  hourlyRateHt: z.number().min(0, "Le taux horaire ne peut pas être négatif.").max(10_000_000, "Le taux horaire est trop élevé."),
});

export const workshopLaborRatesResponseSchema = z.array(workshopLaborRateSchema);

export type WorkshopLaborRate = z.infer<typeof workshopLaborRateSchema>;
export type CreateWorkshopLaborRateRequest = z.infer<typeof createWorkshopLaborRateRequestSchema>;
