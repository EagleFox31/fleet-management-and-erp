/**
 * Factures en attente de paiement et retenues à la source (lot F1).
 *
 * Retenues d'une facture déposée : figées au dépôt (`client_invoices.withholding_*`, `net_payable`).
 * Facture pas encore déposée : calculées à la lecture depuis les taux actuels du client.
 * Le calcul vit dans `shared/finance/withholding.ts`, jamais ici.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import type {
  ClientWithholdingRequest,
  InvoiceAwaitingPayment,
  InvoicesAwaitingPaymentResponse,
} from "@shared/contracts/invoices-awaiting-payment";
import { computeWithholdings, daysSinceDeposit, type WithholdingBase } from "@shared/finance/withholding";

/** Statuts d'une facture émise et pas encore soldée. */
export const AWAITING_PAYMENT_STATUSES = ["pending", "partial", "overdue"] as const;

const INVOICE_NOT_FOUND = "Facture introuvable.";
const CLIENT_NOT_FOUND = "Client introuvable.";

interface InvoiceRow {
  id: number;
  invoice_number: string;
  invoice_date: string;
  status: string;
  client_id: number | null;
  client_name: string | null;
  amount_ht: string;
  amount_ttc: string;
  balance: string;
  deposited_at: string | null;
  withholding_vat_amount: string | null;
  withholding_is_amount: string | null;
  net_payable: string | null;
  withholding_vat_rate: string | null;
  withholding_is_rate: string | null;
  withholding_is_base: WithholdingBase;
  /** Totaux de la liste, sommés en numeric par Postgres (fenêtre sur toute la sélection). */
  total_ht?: string;
  total_ttc?: string;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

const num = (v: string | null): number => (v === null ? 0 : Number(v));

function computedFor(row: InvoiceRow) {
  return computeWithholdings(
    { amountHt: num(row.amount_ht), amountTtc: num(row.amount_ttc) },
    {
      vatWithholdingRate: num(row.withholding_vat_rate),
      isWithholdingRate: num(row.withholding_is_rate),
      isBase: row.withholding_is_base,
    },
  );
}

function toItem(row: InvoiceRow, today: string): InvoiceAwaitingPayment {
  const frozen = row.net_payable !== null;
  const amounts = frozen
    ? {
        withholdingVatAmount: num(row.withholding_vat_amount),
        withholdingIsAmount: num(row.withholding_is_amount),
        netPayable: num(row.net_payable),
      }
    : computedFor(row);
  return {
    invoiceId: row.id,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    clientName: row.client_name,
    amountHt: num(row.amount_ht),
    amountTtc: num(row.amount_ttc),
    ...amounts,
    withholdingIsBase: row.withholding_is_base,
    withholdingFrozen: frozen,
    depositedAt: row.deposited_at,
    daysSinceDeposit: daysSinceDeposit(row.deposited_at, today),
    balanceDue: num(row.balance),
  };
}

// LEFT JOIN : une facture sans client (client_id nullable) reste listée, sans retenue (taux NULL, base HT).
const SELECT_INVOICES = sql`
  SELECT i.id, i.invoice_number, i.invoice_date::text AS invoice_date, i.status,
         c.id AS client_id, c.name AS client_name,
         i.amount_ht, i.amount_ttc, i.balance, i.deposited_at::text AS deposited_at,
         i.withholding_vat_amount, i.withholding_is_amount, i.net_payable,
         c.withholding_vat_rate, c.withholding_is_rate, COALESCE(c.withholding_is_base, 'ht') AS withholding_is_base
  FROM client_invoices i
  LEFT JOIN clients c ON c.id = i.client_id`;

type Executor = Pick<typeof db, "execute">;

/**
 * `lock` : verrouille la seule facture (`FOR UPDATE OF i`), pas le client. Deux dépôts concurrents
 * de la même facture sont sérialisés ; un changement de taux concurrent n'est pas bloqué, et le dépôt
 * fige les taux lus à cet instant (ceux validés avant la lecture). C'est voulu : le taux figé est
 * celui en vigueur au moment du dépôt, un changement ultérieur ne touche que les factures non déposées.
 */
async function invoiceRow(executor: Executor, id: number, lock: boolean): Promise<InvoiceRow | undefined> {
  const result = await executor.execute(
    lock ? sql`${SELECT_INVOICES} WHERE i.id = ${id} FOR UPDATE OF i` : sql`${SELECT_INVOICES} WHERE i.id = ${id}`,
  );
  return rowsOf<InvoiceRow>(result)[0];
}

export async function listInvoicesAwaitingPayment(now: Date = new Date()): Promise<InvoicesAwaitingPaymentResponse> {
  const today = isoDateInZone(now);
  const result = await db.execute(sql`
    SELECT s.*, sum(s.amount_ht) OVER ()::text AS total_ht, sum(s.amount_ttc) OVER ()::text AS total_ttc
    FROM (${SELECT_INVOICES} WHERE i.status IN ('pending', 'partial', 'overdue')) s
    ORDER BY s.deposited_at ASC NULLS LAST, s.invoice_date ASC, s.id ASC`);
  const rows = rowsOf<InvoiceRow>(result);
  const items = rows.map((row) => toItem(row, today));
  // Retenues et net : entiers FCFA arrondis par le module de calcul, la somme JS est exacte.
  const sum = (key: "withholdingVatAmount" | "withholdingIsAmount" | "netPayable") =>
    items.reduce((total, item) => total + item[key], 0);
  return {
    items,
    totals: {
      count: items.length,
      amountHt: num(rows[0]?.total_ht ?? null),
      amountTtc: num(rows[0]?.total_ttc ?? null),
      withholdingVatAmount: sum("withholdingVatAmount"),
      withholdingIsAmount: sum("withholdingIsAmount"),
      netPayable: sum("netPayable"),
    },
  };
}

/**
 * Dépose la facture chez le client et fige ses retenues. Rejouer la même date ne réécrit rien
 * (`changed: false`) ; une autre date sur une facture déjà déposée est un conflit.
 */
export async function depositInvoice(
  id: number,
  depositedAt: string,
  userId: number,
  now: Date = new Date(),
): Promise<{ item: InvoiceAwaitingPayment; changed: boolean }> {
  const today = isoDateInZone(now);
  if (depositedAt > today) throw new AppError(400, "La date de dépôt ne peut pas être dans le futur.");

  return db.transaction(async (tx) => {
    const row = await invoiceRow(tx, id, true);
    if (!row) throw new AppError(404, INVOICE_NOT_FOUND);
    if (row.deposited_at === depositedAt) return { item: toItem(row, today), changed: false };
    if (row.deposited_at !== null) {
      throw new AppError(409, `Cette facture est déjà déposée depuis le ${row.deposited_at}.`);
    }
    if (!(AWAITING_PAYMENT_STATUSES as readonly string[]).includes(row.status)) {
      throw new AppError(409, "Seule une facture en attente de paiement peut être déposée.");
    }
    if (depositedAt < row.invoice_date) {
      throw new AppError(400, "La date de dépôt ne peut pas précéder la date de la facture.");
    }
    const amounts = computedFor(row);
    await tx.execute(sql`
      UPDATE client_invoices
      SET deposited_at = ${depositedAt},
          withholding_vat_amount = ${amounts.withholdingVatAmount},
          withholding_is_amount = ${amounts.withholdingIsAmount},
          net_payable = ${amounts.netPayable},
          deposited_by = ${userId},
          updated_at = now()
      WHERE id = ${id}`);
    const updated = await invoiceRow(tx, id, false);
    return { item: toItem(updated!, today), changed: true };
  });
}

export interface ClientWithholding {
  clientId: number;
  vatWithholdingRate: number | null;
  isWithholdingRate: number | null;
  isBase: WithholdingBase;
}

/** Taux de retenue d'un client. Mêmes valeurs : aucune écriture (`changed: false`). */
export async function updateClientWithholding(
  clientId: number,
  input: ClientWithholdingRequest,
  userId: number,
): Promise<{ withholding: ClientWithholding; changed: boolean }> {
  return db.transaction(async (tx) => {
    const current = rowsOf<{ withholding_vat_rate: string | null; withholding_is_rate: string | null; withholding_is_base: WithholdingBase }>(
      await tx.execute(sql`
        SELECT withholding_vat_rate, withholding_is_rate, withholding_is_base
        FROM clients WHERE id = ${clientId} FOR UPDATE`),
    )[0];
    if (!current) throw new AppError(404, CLIENT_NOT_FOUND);
    const asRate = (v: string | null) => (v === null ? null : Number(v));
    const withholding: ClientWithholding = {
      clientId,
      vatWithholdingRate: input.vatWithholdingRate,
      isWithholdingRate: input.isWithholdingRate,
      isBase: input.isBase,
    };
    const same =
      asRate(current.withholding_vat_rate) === input.vatWithholdingRate &&
      asRate(current.withholding_is_rate) === input.isWithholdingRate &&
      current.withholding_is_base === input.isBase;
    if (same) return { withholding, changed: false };
    await tx.execute(sql`
      UPDATE clients
      SET withholding_vat_rate = ${input.vatWithholdingRate},
          withholding_is_rate = ${input.isWithholdingRate},
          withholding_is_base = ${input.isBase},
          withholding_updated_by = ${userId},
          updated_at = now()
      WHERE id = ${clientId}`);
    return { withholding, changed: true };
  });
}
