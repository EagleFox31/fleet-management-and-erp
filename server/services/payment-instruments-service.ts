import { sql, type SQL } from "drizzle-orm";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import {
  PAYMENT_INSTRUMENT_KIND_LABELS,
  type ClosePaymentInstrumentInput,
  type CreatePaymentInstrumentInput,
  type ListPaymentInstrumentsQuery,
  type PaymentInstrument,
  type PaymentInstrumentAlert,
  type PaymentInstrumentDirection,
  type PaymentInstrumentKind,
  type PaymentInstrumentsResponse,
  type PaymentInstrumentStatus,
  type PayPaymentInstrumentInput,
  type UpdatePaymentInstrumentInput,
} from "@shared/contracts/payment-instruments";
import { paymentInstruments, treasuryEntries } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { requireActiveAccount } from "./treasury-service";

/**
 * Traites et chèques (lot T4). Une échéance naît « en attente » ; « payée » écrit au journal de
 * trésorerie dans la même transaction (écriture de clé `instrument:<id>`, hors de portée d'une clé
 * client, qui est préfixée `entry:` ou `transfer:`). Contrat : shared/contracts/payment-instruments.ts.
 */

type Executor = Pick<typeof db, "execute" | "insert" | "select">;
type Row = Record<string, unknown>;

const NOT_FOUND = "Traite ou chèque introuvable.";
const NOT_PENDING = "Seule une échéance en attente peut être modifiée.";
const DUE_BEFORE_ISSUE = "L'échéance ne peut pas précéder la date d'émission.";
const BAD_LINK = "Un lien (fournisseur, client ou véhicule) n'existe pas.";

const today = (now: Date) => isoDateInZone(now);

/** Colonnes lues, jours avant échéance et alerte calculés en SQL ; `paymentInstrumentAlert` en est l'oracle de test. */
function instrumentSelect(todayIso: string, alertDays: number): SQL {
  return sql`
    SELECT p.id, p.kind, p.direction, p.number, p.drawer, p.drawee, p.paying_bank, p.amount::text AS amount,
           to_char(p.issue_date, 'YYYY-MM-DD') AS issue_date, to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
           p.status, to_char(p.paid_at, 'YYYY-MM-DD') AS paid_at, p.treasury_entry_id, e.account_id AS paid_account_id,
           p.supplier_id, p.client_id, p.vehicle_id, p.observations, p.request_key,
           (p.due_date - ${todayIso}::date) AS days_until_due,
           CASE WHEN p.status <> 'pending' THEN 'none'
                WHEN p.due_date < ${todayIso}::date THEN 'overdue'
                WHEN p.due_date - ${todayIso}::date <= ${alertDays} THEN 'due_soon'
                ELSE 'none' END AS alert
    FROM payment_instruments p LEFT JOIN treasury_entries e ON e.id = p.treasury_entry_id`;
}

const nullableId = (v: unknown) => (v == null ? null : Number(v));

function toInstrument(r: Row): PaymentInstrument {
  return {
    id: Number(r.id),
    kind: r.kind as PaymentInstrumentKind,
    direction: r.direction as PaymentInstrumentDirection,
    number: String(r.number),
    drawer: String(r.drawer),
    drawee: String(r.drawee),
    payingBank: (r.paying_bank as string | null) ?? null,
    amount: String(r.amount),
    issueDate: String(r.issue_date),
    dueDate: String(r.due_date),
    status: r.status as PaymentInstrumentStatus,
    paidAt: (r.paid_at as string | null) ?? null,
    treasuryEntryId: nullableId(r.treasury_entry_id),
    paidAccountId: nullableId(r.paid_account_id),
    supplierId: nullableId(r.supplier_id),
    clientId: nullableId(r.client_id),
    vehicleId: nullableId(r.vehicle_id),
    observations: (r.observations as string | null) ?? null,
    daysUntilDue: Number(r.days_until_due),
    alert: r.alert as PaymentInstrumentAlert,
  };
}

async function readOne(ex: Executor, where: SQL, now: Date): Promise<(PaymentInstrument & { requestKey: string | null }) | undefined> {
  const res = await ex.execute(sql`${instrumentSelect(today(now), 7)} WHERE ${where}`);
  const row = res.rows[0] as Row | undefined;
  return row ? { ...toInstrument(row), requestKey: (row.request_key as string | null) ?? null } : undefined;
}

async function byId(ex: Executor, id: number, now: Date): Promise<PaymentInstrument> {
  const found = await readOne(ex, sql`p.id = ${id}`, now);
  if (!found) throw new AppError(404, NOT_FOUND);
  const { requestKey: _key, ...instrument } = found;
  return instrument;
}

/** Verrouille la ligne pour la durée de la transaction : deux paiements concurrents se sérialisent. */
async function lockRow(ex: Executor, id: number): Promise<{ status: PaymentInstrumentStatus; issueDate: string; dueDate: string }> {
  const res = await ex.execute(sql`
    SELECT status, to_char(issue_date, 'YYYY-MM-DD') AS issue_date, to_char(due_date, 'YYYY-MM-DD') AS due_date
    FROM payment_instruments WHERE id = ${id} FOR UPDATE`);
  const row = res.rows[0] as Row | undefined;
  if (!row) throw new AppError(404, NOT_FOUND);
  return { status: row.status as PaymentInstrumentStatus, issueDate: String(row.issue_date), dueDate: String(row.due_date) };
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function mapDbError(error: unknown): never {
  const code = pgCode(error);
  if (code === "23503") throw new AppError(422, BAD_LINK, { cause: error });
  if (code === "23514") throw new AppError(422, DUE_BEFORE_ISSUE, { cause: error });
  throw error;
}

/** Champs saisis comparés au rejeu d'une création : même clé, autre contenu = 409. */
const COMPARED = [
  "kind", "direction", "number", "drawer", "drawee", "payingBank", "amount",
  "issueDate", "dueDate", "supplierId", "clientId", "vehicleId", "observations",
] as const;
const sameInstrument = (p: PaymentInstrument, input: CreatePaymentInstrumentInput) =>
  COMPARED.every((field) => (p[field] ?? null) === (input[field] ?? null));

function replay(existing: PaymentInstrument & { requestKey: string | null }, input: CreatePaymentInstrumentInput) {
  if (!sameInstrument(existing, input)) throw new AppError(409, "Cette clé de requête a déjà servi pour une autre échéance.");
  const { requestKey: _key, ...instrument } = existing;
  return { instrument, replayed: true };
}

export const paymentInstrumentsService = {
  async list(query: ListPaymentInstrumentsQuery, now: Date = new Date()): Promise<PaymentInstrumentsResponse> {
    const todayIso = today(now);
    const filters: SQL[] = [sql`TRUE`];
    if (query.status) filters.push(sql`p.status = ${query.status}`);
    if (query.kind) filters.push(sql`p.kind = ${query.kind}`);
    if (query.direction) filters.push(sql`p.direction = ${query.direction}`);
    const where = sql.join(filters, sql` AND `);
    const res = await db.execute(sql`
      ${instrumentSelect(todayIso, query.alertDays)} WHERE ${where}
      ORDER BY (p.status = 'pending') DESC, p.due_date, p.id`);
    const items = (res.rows as Row[]).map(toInstrument);
    const t = (
      await db.execute(sql`
        SELECT count(*)::int AS count,
               count(*) FILTER (WHERE status = 'pending')::int AS pending_count,
               COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'pending'), 0)::numeric(15,2)::text AS pending_amount,
               count(*) FILTER (WHERE alert = 'overdue')::int AS overdue_count,
               COALESCE(SUM(amount::numeric) FILTER (WHERE alert = 'overdue'), 0)::numeric(15,2)::text AS overdue_amount,
               count(*) FILTER (WHERE alert = 'due_soon')::int AS due_soon_count,
               COALESCE(SUM(amount::numeric) FILTER (WHERE alert = 'due_soon'), 0)::numeric(15,2)::text AS due_soon_amount
        FROM (${instrumentSelect(todayIso, query.alertDays)} WHERE ${where}) l`)
    ).rows[0] as Row;
    return {
      items,
      alertDays: query.alertDays,
      totals: {
        count: Number(t.count),
        pendingCount: Number(t.pending_count),
        pendingAmount: String(t.pending_amount),
        overdueCount: Number(t.overdue_count),
        overdueAmount: String(t.overdue_amount),
        dueSoonCount: Number(t.due_soon_count),
        dueSoonAmount: String(t.due_soon_amount),
      },
    };
  },

  async get(id: number, now: Date = new Date()): Promise<PaymentInstrument> {
    return byId(db, id, now);
  },

  /** Rejouée avec la même `requestKey` et le même contenu : l'échéance existante, `replayed: true`. */
  async create(userId: number, input: CreatePaymentInstrumentInput, now: Date = new Date()) {
    const key = input.requestKey ?? null;
    if (key) {
      const existing = await readOne(db, sql`p.request_key = ${key}`, now);
      if (existing) return replay(existing, input);
    }
    try {
      const [row] = await db
        .insert(paymentInstruments)
        .values({
          kind: input.kind,
          direction: input.direction,
          number: input.number,
          drawer: input.drawer,
          drawee: input.drawee,
          payingBank: input.payingBank,
          amount: input.amount,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          supplierId: input.supplierId,
          clientId: input.clientId,
          vehicleId: input.vehicleId,
          observations: input.observations,
          requestKey: key,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: paymentInstruments.id });
      const instrument = await byId(db, row.id, now);
      return { instrument, replayed: false };
    } catch (error) {
      if (pgCode(error) === "23505" && key) {
        const existing = await readOne(db, sql`p.request_key = ${key}`, now);
        if (existing) return replay(existing, input);
        throw new AppError(409, "Cette clé de requête a déjà servi pour une autre échéance.", { cause: error });
      }
      return mapDbError(error);
    }
  },

  /** Correction tant que l'échéance est en attente ; après paiement, rejet ou annulation : 409. */
  async update(userId: number, id: number, input: UpdatePaymentInstrumentInput, now: Date = new Date()): Promise<PaymentInstrument> {
    try {
      await db.transaction(async (tx) => {
        const ex = tx as unknown as Executor;
        const current = await lockRow(ex, id);
        if (current.status !== "pending") throw new AppError(409, NOT_PENDING);
        const issueDate = input.issueDate ?? current.issueDate;
        const dueDate = input.dueDate ?? current.dueDate;
        if (dueDate < issueDate) throw new AppError(422, DUE_BEFORE_ISSUE);
        await tx
          .update(paymentInstruments)
          .set({ ...input, updatedBy: userId, updatedAt: new Date() })
          .where(sql`${paymentInstruments.id} = ${id}`);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      return mapDbError(error);
    }
    const instrument = await byId(db, id, now);
    return instrument;
  },

  /**
   * Payée : une écriture au journal (sortie pour une échéance à payer, entrée pour une échéance à
   * encaisser) et le statut, dans une transaction. Rejouée avec le même compte et la même date :
   * l'état existant, `replayed: true` ; payée autrement : 409.
   */
  async pay(userId: number, id: number, input: PayPaymentInstrumentInput, now: Date = new Date()) {
    let replayed = false;
    try {
      await db.transaction(async (tx) => {
        const ex = tx as unknown as Executor;
        const current = await lockRow(ex, id);
        const instrument = await byId(ex, id, now);
        if (current.status === "paid") {
          if (instrument.paidAccountId === input.accountId && instrument.paidAt === input.paidAt) {
            replayed = true;
            return;
          }
          throw new AppError(409, "Cette échéance est déjà payée.");
        }
        if (current.status !== "pending") throw new AppError(409, "Une échéance rejetée ou annulée ne peut pas être payée.");
        if (input.paidAt < instrument.issueDate) throw new AppError(422, "Le paiement ne peut pas précéder la date d'émission.");
        await requireActiveAccount(ex, input.accountId);
        const outgoing = instrument.direction === "outgoing";
        const [entry] = await tx
          .insert(treasuryEntries)
          .values({
            accountId: input.accountId,
            entryDate: input.paidAt,
            pieceRef: instrument.number,
            label: `${PAYMENT_INSTRUMENT_KIND_LABELS[instrument.kind]} ${instrument.number}`,
            direction: outgoing ? "out" : "in",
            amount: instrument.amount,
            category: outgoing ? "reglement_fournisseur" : "encaissement_client",
            counterpartyLabel: outgoing ? instrument.drawer : instrument.drawee,
            vehicleId: instrument.vehicleId,
            clientId: instrument.clientId,
            supplierId: instrument.supplierId,
            requestKey: `instrument:${id}`,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning({ id: treasuryEntries.id });
        await tx
          .update(paymentInstruments)
          .set({ status: "paid", paidAt: input.paidAt, treasuryEntryId: entry.id, updatedBy: userId, updatedAt: new Date() })
          .where(sql`${paymentInstruments.id} = ${id}`);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      return mapDbError(error);
    }
    const instrument = await byId(db, id, now);
    return { instrument, replayed };
  },

  /** Rejetée ou annulée, depuis « en attente ». Même statut demandé deux fois : sans effet. */
  async close(userId: number, id: number, input: ClosePaymentInstrumentInput, now: Date = new Date()) {
    let replayed = false;
    await db.transaction(async (tx) => {
      const current = await lockRow(tx as unknown as Executor, id);
      if (current.status === input.status) {
        replayed = true;
        return;
      }
      if (current.status !== "pending") throw new AppError(409, "Seule une échéance en attente peut être rejetée ou annulée.");
      await tx
        .update(paymentInstruments)
        .set({
          status: input.status,
          ...(input.observations ? { observations: input.observations } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(sql`${paymentInstruments.id} = ${id}`);
    });
    const instrument = await byId(db, id, now);
    return { instrument, replayed };
  },
};
