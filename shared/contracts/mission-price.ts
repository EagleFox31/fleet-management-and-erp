import { z } from "zod";
import { MISSION_PRICE_REASON_MIN } from "../constants/roles";
import { bodyIdSchema } from "./common";

/** Prix convenu d'une mission (O3 lot 3b) : lecture avec historique, changement avec motif. XAF entier. */
export const missionPricePath = (missionId: number | string) => `/api/missions/${missionId}/agreed-price`;

/** Corps strict. `tariffGridId` omis = saisie manuelle (plus de tarif d'origine) ; prix null = effacer. */
export const missionPriceBodySchema = z
  .object({
    agreedPrice: z.number().int().min(0).max(999_999_999_999_999).nullable(),
    tariffGridId: bodyIdSchema.nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.tariffGridId == null || b.agreedPrice !== null, {
    message: "Un tarif d'origine suppose un prix convenu.",
    path: ["tariffGridId"],
  });
export type MissionPriceBody = z.infer<typeof missionPriceBodySchema>;

export const missionPriceHistoryRowSchema = z.object({
  id: z.number(),
  oldPrice: z.number().nullable(),
  newPrice: z.number().nullable(),
  oldTariffGridId: z.number().nullable(),
  newTariffGridId: z.number().nullable(),
  reason: z.string().nullable(),
  changedBy: z.number().nullable(),
  changedByName: z.string().nullable(),
  changedAt: z.string(),
});

export const missionPriceResponseSchema = z.object({
  agreedPrice: z.number().nullable(),
  tariffGridId: z.number().nullable(),
  history: z.array(missionPriceHistoryRowSchema),
});
export type MissionPriceResponse = z.infer<typeof missionPriceResponseSchema>;

export const reasonLongEnough = (reason: string | undefined) => (reason ?? "").trim().length >= MISSION_PRICE_REASON_MIN;
