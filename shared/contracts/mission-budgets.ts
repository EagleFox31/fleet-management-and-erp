/**
 * Budget de mission (L1). Drapeau `finance`.
 *
 * Un budget par mission : carburant (litres × prix du jour de `budgetDate`, figé à la saisie),
 * frais de route (FDR) et extras saisis. Aucun barème FDR n'est fourni : montant saisi.
 * Les montants calculés (`fuelAmount`, `totalAmount`) et le prix unitaire sont posés par le
 * serveur, jamais lus dans le corps.
 *
 * Statuts : requested -> approved -> disbursed. `disbursed` est un simple marquage tant que
 * le journal de trésorerie (T1) n'est pas branché ; `treasuryEntryId` reste alors `null`.
 */
import { z } from "zod";
import { bodyIdSchema, isoDateSchema, isoDateTimeSchema } from "./common";

export const MISSION_BUDGETS_PATH = "/api/mission-budgets";
export const MISSION_BUDGETS_DAILY_NEED_PATH = "/api/mission-budgets/daily-need";
export const missionBudgetPath = (id: number) => `${MISSION_BUDGETS_PATH}/${id}`;
export const missionBudgetApprovePath = (id: number) => `${MISSION_BUDGETS_PATH}/${id}/approve`;
export const missionBudgetDisbursePath = (id: number) => `${MISSION_BUDGETS_PATH}/${id}/disburse`;

export const MISSION_BUDGET_STATUSES = ["requested", "approved", "disbursed"] as const;
export type MissionBudgetStatus = (typeof MISSION_BUDGET_STATUSES)[number];

export const MISSION_BUDGET_STATUS_LABELS: Record<MissionBudgetStatus, string> = {
  requested: "Demandé",
  approved: "Approuvé",
  disbursed: "Décaissé",
};

/** Plafond d'un montant saisi : numeric(15,2) en base. */
export const MISSION_BUDGET_MAX_AMOUNT = 1_000_000_000;
/** Plafond des litres d'un budget : numeric(12,2) en base, très au-delà d'un plein de convoi. */
export const MISSION_BUDGET_MAX_LITERS = 100_000;

const amountSchema = z.number().finite().min(0).max(MISSION_BUDGET_MAX_AMOUNT);

export const createMissionBudgetRequestSchema = z
  .object({
    missionId: bodyIdSchema,
    budgetDate: isoDateSchema,
    fuelLiters: z.number().finite().min(0).max(MISSION_BUDGET_MAX_LITERS),
    fdrAmount: amountSchema,
    extrasAmount: amountSchema.default(0),
    notes: z.string().trim().max(1000).nullish(),
  })
  .strict();

/** Correction d'un budget encore demandé. La mission ne change pas : un budget par mission. */
export const updateMissionBudgetRequestSchema = createMissionBudgetRequestSchema
  .omit({ missionId: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à modifier" });

export const missionBudgetSchema = z.object({
  id: bodyIdSchema,
  missionId: bodyIdSchema,
  budgetDate: isoDateSchema,
  fuelLiters: z.number(),
  fuelUnitPrice: z.number(),
  fuelAmount: z.number(),
  fdrAmount: z.number(),
  extrasAmount: z.number(),
  totalAmount: z.number(),
  status: z.enum(MISSION_BUDGET_STATUSES),
  notes: z.string().nullable(),
  treasuryEntryId: bodyIdSchema.nullable(),
  approvedBy: bodyIdSchema.nullable(),
  approvedAt: isoDateTimeSchema.nullable(),
  disbursedBy: bodyIdSchema.nullable(),
  disbursedAt: isoDateTimeSchema.nullable(),
  createdBy: bodyIdSchema.nullable(),
  updatedBy: bodyIdSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const missionBudgetsQuerySchema = z
  .object({
    date: isoDateSchema.optional(),
    status: z.enum(MISSION_BUDGET_STATUSES).optional(),
  })
  .strict();

export const missionBudgetsResponseSchema = z.array(missionBudgetSchema);

export const dailyNeedQuerySchema = z.object({ date: isoDateSchema }).strict();

const totalsSchema = z.object({
  count: z.number().int(),
  fuelAmount: z.number(),
  fdrAmount: z.number(),
  extrasAmount: z.number(),
  totalAmount: z.number(),
});

/** Besoin du jour : somme des budgets de la date, au total et par statut. */
export const dailyNeedResponseSchema = totalsSchema.extend({
  date: isoDateSchema,
  byStatus: z.record(z.enum(MISSION_BUDGET_STATUSES), totalsSchema),
});

export type CreateMissionBudgetRequest = z.infer<typeof createMissionBudgetRequestSchema>;
export type UpdateMissionBudgetRequest = z.infer<typeof updateMissionBudgetRequestSchema>;
export type MissionBudget = z.infer<typeof missionBudgetSchema>;
export type DailyNeed = z.infer<typeof dailyNeedResponseSchema>;

/** Montants en centimes entiers : pas d'erreur d'arrondi flottant sur une somme d'argent. */
const toCents = (value: number) => Math.round(value * 100);

/**
 * Calcul du budget : carburant = litres × prix du litre, arrondi au centime ; total = carburant + FDR + extras.
 * Seule source du calcul : le serveur l'applique, l'écran peut l'afficher en aperçu.
 */
export function computeMissionBudget(input: {
  fuelLiters: number;
  fuelUnitPrice: number;
  fdrAmount: number;
  extrasAmount: number;
}): { fuelAmount: number; totalAmount: number } {
  const fuelCents = Math.round((toCents(input.fuelLiters) * toCents(input.fuelUnitPrice)) / 100);
  const totalCents = fuelCents + toCents(input.fdrAmount) + toCents(input.extrasAmount);
  return { fuelAmount: fuelCents / 100, totalAmount: totalCents / 100 };
}
