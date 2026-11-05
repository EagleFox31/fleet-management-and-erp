/**
 * Contrôles inopinés QHSE (lot Q1, drapeau `qhse`). Source : fiches de contrôle inopiné « en cabine »
 * et « à l'arrêt » (attached_assets, « Intégration du module QHSE dans le SI de T.A.Y »).
 * Le contrôleur note chaque critère OK (A) ou Pas OK (B) et peut ajouter une observation.
 */
import { z } from "zod";
import { bodyIdSchema, idSchema, isoDateSchema, pageQuerySchema } from "./common";

export const QHSE_INSPECTION_KINDS = ["cabin", "stop"] as const;
export type QhseInspectionKind = (typeof QHSE_INSPECTION_KINDS)[number];

export const QHSE_INSPECTION_KIND_LABELS: Record<QhseInspectionKind, string> = {
  cabin: "En cabine",
  stop: "À l'arrêt",
};

export const qhseInspectionKindSchema = z.enum(QHSE_INSPECTION_KINDS);

const textSchema = (max: number) => z.string().trim().max(max);

export const createQhseCriterionRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Le code n'accepte que des minuscules, des chiffres et le tiret bas."),
  label: textSchema(200).min(2, "Le libellé est obligatoire."),
  category: qhseInspectionKindSchema,
  sortOrder: z.number().int().min(0).max(10000).optional(),
});
export type CreateQhseCriterionRequest = z.infer<typeof createQhseCriterionRequestSchema>;

export const updateQhseCriterionRequestSchema = z
  .object({
    label: textSchema(200).min(2).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });
export type UpdateQhseCriterionRequest = z.infer<typeof updateQhseCriterionRequestSchema>;

export const qhseCriteriaQuerySchema = z.object({
  category: qhseInspectionKindSchema.optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const qhseInspectionItemInputSchema = z.object({
  criterionId: bodyIdSchema,
  conform: z.boolean(),
  observation: textSchema(1000).optional(),
});

/** Écart d'horloge toléré entre le poste du contrôleur et le serveur pour `inspectedAt`. */
export const QHSE_INSPECTED_AT_FUTURE_TOLERANCE_MS = 5 * 60_000;

export const createQhseInspectionRequestSchema = z.object({
  kind: qhseInspectionKindSchema,
  inspectedAt: z
    .string()
    .datetime({ offset: true })
    .refine((v) => Date.parse(v) <= Date.now() + QHSE_INSPECTED_AT_FUTURE_TOLERANCE_MS, {
      message: "La date du contrôle ne peut pas être dans le futur.",
    })
    .optional(),
  location: textSchema(200).min(2, "Le lieu du contrôle est obligatoire."),
  vehicleId: bodyIdSchema,
  driverId: bodyIdSchema,
  items: z.array(qhseInspectionItemInputSchema).min(1, "Au moins un critère doit être noté.").max(100),
  generalObservation: textSchema(2000).optional(),
});
export type CreateQhseInspectionRequest = z.infer<typeof createQhseInspectionRequestSchema>;

export const qhseInspectionsQuerySchema = pageQuerySchema.extend({
  kind: qhseInspectionKindSchema.optional(),
  driverId: idSchema.optional(),
  vehicleId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type QhseInspectionsQuery = z.infer<typeof qhseInspectionsQuerySchema>;

export type QhseCriterion = {
  id: number;
  code: string;
  label: string;
  category: QhseInspectionKind;
  active: boolean;
  sortOrder: number;
};

/** Ligne enregistrée : code et libellé du critère sont figés à la saisie (l'historique survit à un renommage). */
export type QhseInspectionItem = {
  criterionId: number;
  code: string;
  label: string;
  conform: boolean;
  observation?: string;
};

export type QhseInspection = {
  id: number;
  kind: QhseInspectionKind;
  inspectedAt: string;
  location: string;
  vehicleId: number;
  driverId: number;
  inspectorId: number;
  items: QhseInspectionItem[];
  generalObservation: string | null;
  nonConformCount: number;
  createdAt: string;
};
