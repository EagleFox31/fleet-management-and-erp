/**
 * Budget de mission (L1). Drapeau `finance`.
 *
 * Un budget par mission : carburant (litres × prix du jour de `budgetDate`, figé à la saisie),
 * frais de route (FDR) et extras saisis.
 *
 * Barème (L1b) : une destination de la liste fermée `mission_destinations`, choisie à la main
 * (aucun rapprochement avec l'adresse de la mission), pré-remplit les litres et le FDR absents
 * du corps. Une valeur fournie l'emporte toujours : le barème propose, il n'impose pas.
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
export const MISSION_DESTINATIONS_PATH = "/api/mission-budgets/destinations";

export const MISSION_BUDGET_STATUSES = ["requested", "approved", "disbursed"] as const;
export type MissionBudgetStatus = (typeof MISSION_BUDGET_STATUSES)[number];

export const MISSION_BUDGET_STATUS_LABELS: Record<MissionBudgetStatus, string> = {
  requested: "Demandé",
  approved: "Approuvé",
  disbursed: "Décaissé",
};

/** Mission close : plus de budget à saisir pour elle (409). */
export const MISSION_STATUSES_WITHOUT_BUDGET = ["completed", "cancelled"] as const;

/** Plafond d'un montant saisi : numeric(15,2) en base. */
export const MISSION_BUDGET_MAX_AMOUNT = 1_000_000_000;
/** Plafond des litres d'un budget : numeric(12,2) en base, très au-delà d'un plein de convoi. */
export const MISSION_BUDGET_MAX_LITERS = 100_000;

/**
 * Fenêtre de `budgetDate` autour du jour courant (UTC) : au-delà, le prix figé n'a pas de sens
 * (budget saisi pour un passé lointain ou un futur sans prix posé).
 */
export const MISSION_BUDGET_DATE_WINDOW_DAYS = 60;

/** `budgetDate` dans [today - fenêtre ; today + fenêtre], dates AAAA-MM-JJ comparées en UTC. */
export function isBudgetDateInWindow(budgetDate: string, today: string): boolean {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
  return Math.abs(day(budgetDate) - day(today)) <= MISSION_BUDGET_DATE_WINDOW_DAYS;
}

/**
 * Approbation et décaissement portent la version lue : `expectedUpdatedAt` est le `updatedAt`
 * affiché. Si le budget a changé depuis (correction, autre transition), la transition répond 409.
 */
export const missionBudgetTransitionRequestSchema = z.object({ expectedUpdatedAt: isoDateTimeSchema }).strict();
export type MissionBudgetTransitionRequest = z.infer<typeof missionBudgetTransitionRequestSchema>;

/**
 * Décaissement (L1c) : la version lue, et le compte de trésorerie (banque ou caisse) d'où sort
 * l'argent. Sans compte, le décaissement reste un marquage, rien n'est écrit au journal.
 */
export const missionBudgetDisburseRequestSchema = missionBudgetTransitionRequestSchema
  .extend({ treasuryAccountId: bodyIdSchema.nullish() })
  .strict();
export type MissionBudgetDisburseRequest = z.infer<typeof missionBudgetDisburseRequestSchema>;

const amountSchema = z.number().finite().min(0).max(MISSION_BUDGET_MAX_AMOUNT);

const missionBudgetFields = z.object({
  missionId: bodyIdSchema,
  budgetDate: isoDateSchema,
  /** Destination du barème (L1b). Absente ou `null` : saisie libre. */
  destinationId: bodyIdSchema.nullish(),
  fuelLiters: z.number().finite().min(0).max(MISSION_BUDGET_MAX_LITERS),
  fdrAmount: amountSchema,
  extrasAmount: amountSchema.default(0),
  notes: z.string().trim().max(1000).nullish(),
});

/** Sans destination, litres et FDR sont obligatoires ; avec, le barème complète ceux qui manquent. */
export const createMissionBudgetRequestSchema = missionBudgetFields
  .extend({ fuelLiters: missionBudgetFields.shape.fuelLiters.optional(), fdrAmount: amountSchema.optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.destinationId != null) return;
    for (const key of ["fuelLiters", "fdrAmount"] as const) {
      if (v[key] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Requis sans destination du barème" });
    }
  });

/**
 * Correction d'un budget encore demandé. La mission ne change pas : un budget par mission.
 * Changer de destination n'écrase pas les montants déjà saisis : l'écran pré-remplit, le client envoie.
 */
export const updateMissionBudgetRequestSchema = missionBudgetFields
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
  destinationId: bodyIdSchema.nullable(),
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

/** Destination du barème : valeurs de pré-remplissage, toujours modifiables sur le budget. */
export const missionDestinationSchema = z.object({
  id: bodyIdSchema,
  code: z.string(),
  label: z.string(),
  fuelLiters: z.number(),
  fdrAmount: z.number(),
});

export const missionDestinationsResponseSchema = z.array(missionDestinationSchema);

export type MissionDestination = z.infer<typeof missionDestinationSchema>;
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
