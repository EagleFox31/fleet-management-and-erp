import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  nextMonth,
  type CreateTreasuryAccountInput,
  type CreateTreasuryEntryInput,
  type CreateTreasuryTransferInput,
  type FuelRechargeSourceAccount,
  type TreasuryAccount,
  type TreasuryCategory,
  type TreasuryDirection,
  type TreasuryEntry,
  type TreasuryLedger,
} from "@shared/contracts/treasury";
import { ledgerToCsv } from "@shared/contracts/treasury";
import { treasuryAccounts, treasuryEntries } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";

type Executor = Pick<typeof db, "execute" | "insert" | "select">;
type Row = Record<string, unknown>;

const ENTRY_COLUMNS = sql`
  e.id, e.account_id, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.piece_ref, e.label, e.direction,
  e.amount::text AS amount, e.category, e.counterparty_label, e.transfer_group, e.notes,
  e.vehicle_id, e.mission_id, e.client_id, e.supplier_id, e.fuel_record_id, e.supplier_settlement_id`;

function toEntry(r: Row): TreasuryEntry {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    entryDate: String(r.entry_date),
    pieceRef: (r.piece_ref as string | null) ?? null,
    label: String(r.label),
    direction: r.direction as TreasuryDirection,
    amount: String(r.amount),
    category: r.category as TreasuryCategory,
    counterpartyLabel: (r.counterparty_label as string | null) ?? null,
    transferGroup: (r.transfer_group as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    vehicleId: r.vehicle_id == null ? null : Number(r.vehicle_id),
    missionId: r.mission_id == null ? null : Number(r.mission_id),
    clientId: r.client_id == null ? null : Number(r.client_id),
    supplierId: r.supplier_id == null ? null : Number(r.supplier_id),
    fuelRecordId: r.fuel_record_id == null ? null : Number(r.fuel_record_id),
    supplierSettlementId: r.supplier_settlement_id == null ? null : Number(r.supplier_settlement_id),
    balanceAfter: String(r.balance_after),
  };
}

function toAccount(r: Row): TreasuryAccount {
  return {
    id: Number(r.id),
    code: String(r.code),
    label: String(r.label),
    kind: r.kind as TreasuryAccount["kind"],
    bankName: (r.bank_name as string | null) ?? null,
    openingBalance: String(r.opening_balance),
    openingDate: (r.opening_date as string | null) ?? null,
    isActive: Boolean(r.is_active),
    currentBalance: String(r.current_balance),
  };
}

const ACCOUNT_SELECT = sql`
  SELECT a.id, a.code, a.label, a.kind, a.bank_name, a.opening_balance::text AS opening_balance,
         to_char(a.opening_date, 'YYYY-MM-DD') AS opening_date, a.is_active,
         (a.opening_balance + COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END), 0))::numeric(15,2)::text AS current_balance
  FROM treasury_accounts a LEFT JOIN treasury_entries e ON e.account_id = a.id`;

async function accountById(ex: Executor, id: number): Promise<TreasuryAccount> {
  const res = await ex.execute(sql`${ACCOUNT_SELECT} WHERE a.id = ${id} GROUP BY a.id`);
  const row = res.rows[0] as Row | undefined;
  if (!row) throw new AppError(404, "Compte introuvable.");
  return toAccount(row);
}

/** Écritures d'un compte avec leur solde courant (fenêtre sur toute l'histoire du compte), puis filtrées. */
async function ledgerRows(ex: Executor, accountId: number, filter: ReturnType<typeof sql>): Promise<TreasuryEntry[]> {
  const res = await ex.execute(sql`
    SELECT * FROM (
      SELECT ${ENTRY_COLUMNS},
             (a.opening_balance + SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
                OVER (ORDER BY e.entry_date, e.id))::numeric(15,2)::text AS balance_after,
             e.entry_date AS d
      FROM treasury_entries e JOIN treasury_accounts a ON a.id = e.account_id
      WHERE e.account_id = ${accountId}
    ) l WHERE ${filter} ORDER BY l.d, l.id`);
  return (res.rows as Row[]).map(toEntry);
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export async function requireActiveAccount(ex: Executor, id: number): Promise<TreasuryAccount> {
  const account = await accountById(ex, id);
  if (!account.isActive) throw new AppError(409, "Ce compte est désactivé.");
  return account;
}

async function entryByKey(ex: Executor, key: string): Promise<TreasuryEntry | undefined> {
  const res = await ex.execute(sql`SELECT id, account_id FROM treasury_entries WHERE request_key = ${key}`);
  const found = res.rows[0] as Row | undefined;
  if (!found) return undefined;
  const rows = await ledgerRows(ex, Number(found.account_id), sql`l.id = ${Number(found.id)}`);
  return rows[0];
}

/**
 * Espaces de clés séparés : la clé reçue du client est préfixée selon l'opération (`entry:K`,
 * `transfer:K:out`, `transfer:K:in`), ce qui empêche une écriture de clé « K:out » de bloquer le
 * virement de clé « K ». Les lignes posées par une autre opération ont leurs propres préfixes
 * (`fuel:`, `settlement:`), hors de portée d'une clé client.
 */
const entryKey = (key: string) => `entry:${key}`;
const transferKeys = (key: string) => ({ out: `transfer:${key}:out`, inn: `transfer:${key}:in` });

type Comparable = Pick<TreasuryEntry, "accountId" | "direction" | "amount" | "entryDate" | "label" | "category" | "pieceRef" | "notes"> &
  Partial<Pick<TreasuryEntry, "counterpartyLabel" | "vehicleId" | "missionId" | "clientId" | "supplierId">>;
const COMPARED: (keyof Comparable)[] = ["accountId", "direction", "amount", "entryDate", "label", "category", "pieceRef", "notes"];
const LINKS: (keyof Comparable)[] = ["counterpartyLabel", "vehicleId", "missionId", "clientId", "supplierId"];

/** Rejeu : tous les champs saisis doivent être identiques ; sinon la clé a servi à autre chose. */
const sameEntry = (e: TreasuryEntry, input: Comparable, withLinks: boolean) =>
  (withLinks ? [...COMPARED, ...LINKS] : COMPARED).every((field) => (e[field] ?? null) === (input[field] ?? null));

function replay(existing: TreasuryEntry, input: CreateTreasuryEntryInput): { entry: TreasuryEntry; replayed: boolean } {
  if (!sameEntry(existing, input, true)) throw new AppError(409, "Une autre écriture a déjà été enregistrée pour cette saisie. Rechargez la page pour voir les écritures enregistrées.");
  return { entry: existing, replayed: true };
}

const KEY_CONFLICT = "Une autre opération a déjà été enregistrée pour cette saisie. Rechargez la page pour voir les opérations enregistrées.";

export const treasuryService = {
  /** Type d'un compte, ou `null` s'il n'existe pas : contrôle d'accès avant toute lecture du livre. */
  async accountKind(id: number): Promise<TreasuryAccount["kind"] | null> {
    const res = await db.execute(sql`SELECT kind FROM treasury_accounts WHERE id = ${id}`);
    const row = res.rows[0] as { kind: TreasuryAccount["kind"] } | undefined;
    return row?.kind ?? null;
  },
  /** Banques et caisses actives, pour le choix du compte qui paie une recharge. Aucun solde. */
  async listRechargeSourceAccounts(): Promise<FuelRechargeSourceAccount[]> {
    const res = await db.execute(
      sql`SELECT id, code, label, kind FROM treasury_accounts WHERE is_active AND kind IN ('bank', 'cash') ORDER BY kind, code`,
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      code: String(r.code),
      label: String(r.label),
      kind: r.kind as FuelRechargeSourceAccount["kind"],
    }));
  },
  async listAccounts(): Promise<TreasuryAccount[]> {
    const res = await db.execute(sql`${ACCOUNT_SELECT} GROUP BY a.id ORDER BY a.is_active DESC, a.code`);
    return (res.rows as Row[]).map(toAccount);
  },

  async createAccount(userId: number, input: CreateTreasuryAccountInput): Promise<TreasuryAccount> {
    try {
      const [row] = await db
        .insert(treasuryAccounts)
        .values({
          code: input.code,
          label: input.label,
          kind: input.kind,
          bankName: input.bankName,
          openingBalance: input.openingBalance,
          openingDate: input.openingDate,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: treasuryAccounts.id });
      return await accountById(db, row.id);
    } catch (error) {
      if (pgCode(error) === "23505") {
        const e = error as { constraint?: string; cause?: { constraint?: string } };
        const fuelCard = (e?.constraint ?? e?.cause?.constraint) === "uq_treasury_accounts_active_fuel_card";
        throw new AppError(409, fuelCard ? "Un compte carte carburant actif existe déjà." : "Ce code de compte existe déjà.", { cause: error });
      }
      throw error;
    }
  },

  async ledger(accountId: number, month: string): Promise<TreasuryLedger> {
    const account = await accountById(db, accountId);
    const from = `${month}-01`;
    const to = `${nextMonth(month)}-01`;
    const entries = await ledgerRows(db, accountId, sql`l.d >= ${from}::date AND l.d < ${to}::date`);
    const res = await db.execute(sql`
      SELECT
        (a.opening_balance + COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FILTER (WHERE e.entry_date < ${from}::date), 0))::numeric(15,2)::text AS opening_balance,
        COALESCE(SUM(e.amount) FILTER (WHERE e.direction = 'in' AND e.entry_date >= ${from}::date AND e.entry_date < ${to}::date), 0)::numeric(15,2)::text AS total_in,
        COALESCE(SUM(e.amount) FILTER (WHERE e.direction = 'out' AND e.entry_date >= ${from}::date AND e.entry_date < ${to}::date), 0)::numeric(15,2)::text AS total_out,
        COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FILTER (WHERE e.entry_date >= ${from}::date AND e.entry_date < ${to}::date), 0)::numeric(15,2)::text AS net,
        (a.opening_balance + COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FILTER (WHERE e.entry_date < ${to}::date), 0))::numeric(15,2)::text AS closing_balance
      FROM treasury_accounts a LEFT JOIN treasury_entries e ON e.account_id = a.id
      WHERE a.id = ${accountId} GROUP BY a.id`);
    const t = res.rows[0] as Row;
    return {
      account,
      month,
      openingBalance: String(t.opening_balance),
      entries,
      totals: { in: String(t.total_in), out: String(t.total_out), net: String(t.net) },
      closingBalance: String(t.closing_balance),
    };
  },

  /** Une écriture. Rejouée avec la même `requestKey` et le même contenu : la ligne existante, `replayed: true`. */
  async createEntry(userId: number, input: CreateTreasuryEntryInput): Promise<{ entry: TreasuryEntry; replayed: boolean }> {
    const key = input.requestKey ? entryKey(input.requestKey) : null;
    if (key) {
      const existing = await entryByKey(db, key);
      if (existing) return replay(existing, input);
    }
    await requireActiveAccount(db, input.accountId);
    try {
      const [row] = await db
        .insert(treasuryEntries)
        .values({
          accountId: input.accountId,
          entryDate: input.entryDate,
          pieceRef: input.pieceRef,
          label: input.label,
          direction: input.direction,
          amount: input.amount,
          category: input.category,
          counterpartyLabel: input.counterpartyLabel,
          notes: input.notes,
          vehicleId: input.vehicleId,
          missionId: input.missionId,
          clientId: input.clientId,
          supplierId: input.supplierId,
          requestKey: key,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: treasuryEntries.id });
      const [entry] = await ledgerRows(db, input.accountId, sql`l.id = ${row.id}`);
      return { entry, replayed: false };
    } catch (error) {
      const code = pgCode(error);
      if (code === "23505" && key) {
        const existing = await entryByKey(db, key);
        if (existing) return replay(existing, input);
        throw new AppError(409, KEY_CONFLICT, { cause: error });
      }
      if (code === "23503") {
        throw new AppError(422, "Un lien (véhicule, mission, client ou fournisseur) n'existe pas.", { cause: error });
      }
      throw error;
    }
  },

  /** Virement interne : sortie du compte source et entrée du compte cible, liées par `transferGroup`, dans une transaction. */
  async createTransfer(userId: number, input: CreateTreasuryTransferInput): Promise<{ entries: [TreasuryEntry, TreasuryEntry]; replayed: boolean }> {
    const keys = input.requestKey ? transferKeys(input.requestKey) : null;
    const outKey = keys?.out ?? null;
    const inKey = keys?.inn ?? null;
    const replayOf = async () => {
      if (!outKey || !inKey) return undefined;
      const out = await entryByKey(db, outKey);
      const inn = await entryByKey(db, inKey);
      if (!out || !inn) return undefined;
      const shared = { amount: input.amount, entryDate: input.entryDate, label: input.label, category: "virement_interne" as const, pieceRef: input.pieceRef, notes: input.notes };
      const same =
        sameEntry(out, { ...shared, accountId: input.fromAccountId, direction: "out" }, false) &&
        sameEntry(inn, { ...shared, accountId: input.toAccountId, direction: "in" }, false);
      if (!same) throw new AppError(409, "Un autre virement a déjà été enregistré pour cette saisie. Rechargez la page pour voir les virements enregistrés.");
      return { entries: [out, inn] as [TreasuryEntry, TreasuryEntry], replayed: true };
    };
    const already = await replayOf();
    if (already) return already;
    try {
      const ids = await db.transaction(async (tx) => {
        const executor = tx as unknown as Executor;
        const from = await requireActiveAccount(executor, input.fromAccountId);
        const to = await requireActiveAccount(executor, input.toAccountId);
        const common = {
          entryDate: input.entryDate,
          pieceRef: input.pieceRef,
          label: input.label,
          amount: input.amount,
          category: "virement_interne" as const,
          notes: input.notes,
          transferGroup: randomUUID(),
          createdBy: userId,
          updatedBy: userId,
        };
        const [out] = await tx
          .insert(treasuryEntries)
          .values({ ...common, accountId: from.id, direction: "out", counterpartyLabel: to.label, requestKey: outKey })
          .returning({ id: treasuryEntries.id });
        const [inn] = await tx
          .insert(treasuryEntries)
          .values({ ...common, accountId: to.id, direction: "in", counterpartyLabel: from.label, requestKey: inKey })
          .returning({ id: treasuryEntries.id });
        return { out: out.id, inn: inn.id };
      });
      const [out] = await ledgerRows(db, input.fromAccountId, sql`l.id = ${ids.out}`);
      const [inn] = await ledgerRows(db, input.toAccountId, sql`l.id = ${ids.inn}`);
      return { entries: [out, inn], replayed: false };
    } catch (error) {
      if (pgCode(error) === "23505" && outKey) {
        const raced = await replayOf();
        if (raced) return raced;
        throw new AppError(409, KEY_CONFLICT, { cause: error });
      }
      throw error;
    }
  },
};

export { ledgerToCsv };
