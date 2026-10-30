/**
 * Pointage (P-20), codes de la feuille Excel. Drapeau `time-tracking`.
 *
 * Une saisie par personne et par jour : une seconde saisie remplace la
 * première. `month` et `year` sont dérivés de la date par le serveur. Les
 * totaux mensuels sont calculés à la lecture.
 */
import { z } from "zod";
import { isoDateSchema } from "./common";

export const TIME_TRACKING_PATH = "/api/time-tracking";
export const TIME_TRACKING_MONTHLY_STATS_PATH = "/api/time-tracking/monthly-stats";

export const TIME_CODES = ["JT", "M", "Mi", "C", "A", "R", "Re"] as const;
export type TimeCode = (typeof TIME_CODES)[number];

export const TIME_CODE_LABELS: Record<TimeCode, string> = {
  JT: "Journée travaillée",
  M: "Maladie",
  Mi: "Mission",
  C: "Congé",
  A: "Absent",
  R: "Repos",
  Re: "Retard",
};

const monthQuery = {
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
};

export const timeTrackingQuerySchema = z.object({ userId: z.coerce.number().int().positive().optional(), ...monthQuery });
export const timeTrackingMonthlyStatsQuerySchema = z.object(monthQuery);

export const timeTrackingEntrySchema = z.object({
  userId: z.number().int(),
  date: isoDateSchema,
  status: z.enum(TIME_CODES),
  notes: z.string().nullable(),
});

export const upsertTimeTrackingRequestSchema = z.object({
  userId: z.number().int().positive(),
  date: isoDateSchema,
  status: z.enum(TIME_CODES),
  notes: z.string().trim().max(500).optional(),
});

export const timeTrackingResponseSchema = z.array(timeTrackingEntrySchema);

export const timeTrackingMonthlyStatsResponseSchema = z.array(
  z.object({
    userId: z.number().int(),
    userName: z.string(),
    counts: z.record(z.enum(TIME_CODES), z.number().int().min(0)),
  }),
);

export type TimeTrackingQuery = z.infer<typeof timeTrackingQuerySchema>;
export type TimeTrackingEntry = z.infer<typeof timeTrackingEntrySchema>;
export type UpsertTimeTrackingRequest = z.infer<typeof upsertTimeTrackingRequestSchema>;
export type TimeTrackingMonthlyStatsResponse = z.infer<typeof timeTrackingMonthlyStatsResponseSchema>;
