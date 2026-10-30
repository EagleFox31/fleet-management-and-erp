/**
 * Contrôle qualité d'un ordre de travail (P-25). Drapeau `quality-check`.
 * Un refus exige un motif. Événement : `work_order_updated` (existant).
 */
import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const qualityCheckPath = (id: number) => `/api/work-orders/${id}/quality-check`;
export const qualityCheckParamsSchema = z.object({ id: idSchema });

export const QC_RESULTS = ["passed", "failed"] as const;
export type QcResult = (typeof QC_RESULTS)[number];

export const qualityCheckRequestSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("passed"), reason: z.string().trim().max(1000).optional() }),
  z.object({ result: z.literal("failed"), reason: z.string().trim().min(3, "Indiquez le motif du refus.").max(1000) }),
]);

export const qualityCheckResponseSchema = z.object({
  workOrderId: z.number().int(),
  qcStatus: z.enum(QC_RESULTS),
  qcBy: z.number().int(),
  qcAt: isoDateTimeSchema,
  qcReason: z.string().nullable(),
});

export type QualityCheckRequest = z.infer<typeof qualityCheckRequestSchema>;
export type QualityCheckResponse = z.infer<typeof qualityCheckResponseSchema>;
