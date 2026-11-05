/**
 * Traites et chèques (lot T4) : contrat partagé serveur / interface.
 *
 * Routes (drapeau `finance`, 404 s'il est coupé) :
 * - GET  /api/treasury/instruments              liste, jours avant échéance, alertes, totaux  (lecture : TREASURY_READ_ROLES)
 * - POST /api/treasury/instruments              créer une traite ou un chèque               (saisie : TREASURY_WRITE_ROLES)
 * - PATCH /api/treasury/instruments/:id         corriger, tant qu'elle est en attente      (saisie)
 * - POST /api/treasury/instruments/:id/pay      payée : écriture du journal, même transaction (saisie)
 * - POST /api/treasury/instruments/:id/status   rejetée ou annulée, depuis « en attente »   (saisie)
 *
 * Sens par défaut : `outgoing`. Dans les fichiers du client, TAY est le tiré (payeur) : CFAO tire sur
 * TAY, domiciliation SGC (échéancier d'achat de camions). Une traite reçue d'un client est `incoming`.
 *
 * Montants en chaînes à 2 décimales ; jours avant échéance calculés par le serveur à la date de Douala.
 */
import { z } from "zod";
import { bodyIdSchema } from "./common";
import { dateSchema, positiveAmountSchema } from "./treasury";

export const PAYMENT_INSTRUMENTS_PATH = "/api/treasury/instruments";

export const PAYMENT_INSTRUMENT_KINDS = ["traite", "cheque"] as const;
export const PAYMENT_INSTRUMENT_DIRECTIONS = ["outgoing", "incoming"] as const;
export const PAYMENT_INSTRUMENT_STATUSES = ["pending", "paid", "bounced", "cancelled"] as const;
/** Statuts posés par POST /:id/status ; « payée » passe par /pay, qui écrit au journal. */
export const PAYMENT_INSTRUMENT_CLOSING_STATUSES = ["bounced", "cancelled"] as const;
export const PAYMENT_INSTRUMENT_ALERTS = ["overdue", "due_soon", "none"] as const;

export type PaymentInstrumentKind = (typeof PAYMENT_INSTRUMENT_KINDS)[number];
export type PaymentInstrumentDirection = (typeof PAYMENT_INSTRUMENT_DIRECTIONS)[number];
export type PaymentInstrumentStatus = (typeof PAYMENT_INSTRUMENT_STATUSES)[number];
export type PaymentInstrumentAlert = (typeof PAYMENT_INSTRUMENT_ALERTS)[number];

/** Libellés : le badge décrit l'échéance suivie (féminin : une traite, une échéance). */
export const PAYMENT_INSTRUMENT_KIND_LABELS: Record<PaymentInstrumentKind, string> = { traite: "Traite", cheque: "Chèque" };
export const PAYMENT_INSTRUMENT_DIRECTION_LABELS: Record<PaymentInstrumentDirection, string> = {
  outgoing: "À payer",
  incoming: "À encaisser",
};
export const PAYMENT_INSTRUMENT_STATUS_LABELS: Record<PaymentInstrumentStatus, string> = {
  pending: "En attente",
  paid: "Payée",
  bounced: "Rejetée",
  cancelled: "Annulée",
};
export const PAYMENT_INSTRUMENT_ALERT_LABELS: Record<PaymentInstrumentAlert, string> = {
  overdue: "Échéance passée",
  due_soon: "Échéance proche",
  none: "",
};

/** Seuil d'alerte par défaut, en jours avant l'échéance. */
export const DEFAULT_ALERT_DAYS = 7;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optionalId = bodyIdSchema.optional().nullable().transform((v) => v ?? null);

const fields = {
  number: text(60),
  drawer: text(120),
  drawee: text(120),
  payingBank: optionalText(120),
  amount: positiveAmountSchema,
  issueDate: dateSchema,
  dueDate: dateSchema,
  supplierId: optionalId,
  clientId: optionalId,
  vehicleId: optionalId,
  observations: optionalText(1000),
};

const DUE_BEFORE_ISSUE = { message: "L'échéance ne peut pas précéder la date d'émission.", path: ["dueDate"] };

export const createPaymentInstrumentSchema = z
  .object({
    kind: z.enum(PAYMENT_INSTRUMENT_KINDS),
    direction: z.enum(PAYMENT_INSTRUMENT_DIRECTIONS).default("outgoing"),
    ...fields,
    requestKey: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.dueDate >= v.issueDate, DUE_BEFORE_ISSUE);
export type CreatePaymentInstrumentInput = z.infer<typeof createPaymentInstrumentSchema>;

/** Correction d'une échéance en attente : champs saisis seulement, jamais le statut ni le paiement. */
export const updatePaymentInstrumentSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucun champ à modifier.");
export type UpdatePaymentInstrumentInput = z.infer<typeof updatePaymentInstrumentSchema>;

export const payPaymentInstrumentSchema = z.object({ accountId: bodyIdSchema, paidAt: dateSchema }).strict();
export type PayPaymentInstrumentInput = z.infer<typeof payPaymentInstrumentSchema>;

export const closePaymentInstrumentSchema = z
  .object({ status: z.enum(PAYMENT_INSTRUMENT_CLOSING_STATUSES), observations: optionalText(1000) })
  .strict();
export type ClosePaymentInstrumentInput = z.infer<typeof closePaymentInstrumentSchema>;

export const listPaymentInstrumentsQuerySchema = z.object({
  status: z.enum(PAYMENT_INSTRUMENT_STATUSES).optional(),
  kind: z.enum(PAYMENT_INSTRUMENT_KINDS).optional(),
  direction: z.enum(PAYMENT_INSTRUMENT_DIRECTIONS).optional(),
  alertDays: z.coerce.number().int().min(0).max(365).default(DEFAULT_ALERT_DAYS),
});
export type ListPaymentInstrumentsQuery = z.infer<typeof listPaymentInstrumentsQuerySchema>;

export type PaymentInstrument = {
  id: number;
  kind: PaymentInstrumentKind;
  direction: PaymentInstrumentDirection;
  number: string;
  drawer: string;
  drawee: string;
  payingBank: string | null;
  amount: string;
  issueDate: string;
  dueDate: string;
  status: PaymentInstrumentStatus;
  paidAt: string | null;
  treasuryEntryId: number | null;
  /** Compte du journal débité ou crédité au paiement. */
  paidAccountId: number | null;
  supplierId: number | null;
  clientId: number | null;
  vehicleId: number | null;
  observations: string | null;
  /** Échéance moins aujourd'hui (Douala) : négatif = passée. */
  daysUntilDue: number;
  alert: PaymentInstrumentAlert;
};

export type PaymentInstrumentsResponse = {
  items: PaymentInstrument[];
  alertDays: number;
  totals: {
    count: number;
    pendingCount: number;
    pendingAmount: string;
    overdueCount: number;
    overdueAmount: string;
    dueSoonCount: number;
    dueSoonAmount: string;
  };
};

/** Alerte d'une échéance : seule une échéance en attente alerte. Oracle des tests contre le SQL. */
export function paymentInstrumentAlert(
  status: PaymentInstrumentStatus,
  daysUntilDue: number,
  alertDays: number = DEFAULT_ALERT_DAYS,
): PaymentInstrumentAlert {
  if (status !== "pending") return "none";
  if (daysUntilDue < 0) return "overdue";
  return daysUntilDue <= alertDays ? "due_soon" : "none";
}

/**
 * Contrepartie inscrite au journal lors du paiement. Traite : le tireur est le créancier, le tiré le
 * débiteur ; chèque : le tireur est l'émetteur, le second nom le bénéficiaire. La contrepartie est
 * donc le tireur pour une traite à payer et un chèque reçu, le second nom sinon.
 */
export function paymentInstrumentCounterparty(
  instrument: Pick<PaymentInstrument, "kind" | "direction" | "drawer" | "drawee">,
): string {
  const drawerIsCounterparty = (instrument.kind === "traite") === (instrument.direction === "outgoing");
  return drawerIsCounterparty ? instrument.drawer : instrument.drawee;
}
