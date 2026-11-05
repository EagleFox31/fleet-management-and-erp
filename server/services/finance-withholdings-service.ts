/**
 * Récapitulatif des retenues à la source sur une période (contrat `shared/contracts/finance-withholdings.ts`).
 * Montants figés au dépôt, sommés en numeric par Postgres : aucun recalcul, aucune dérive flottante.
 */
import { sql } from "drizzle-orm";
import { CANCELLED_CLIENT_INVOICE_STATUS } from "@shared/constants/client-invoices";
import type { FinanceWithholdingLine, FinanceWithholdingsResponse } from "@shared/contracts/finance-withholdings";
import { db } from "../db";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

interface AmountRow {
  count: number | string;
  amount_ht: string | null;
  amount_ttc: string | null;
  vat: string | null;
  is_amount: string | null;
  net: string | null;
}

const amounts = (r: AmountRow) => ({
  count: Number(r.count),
  amountHt: num(r.amount_ht),
  amountTtc: num(r.amount_ttc),
  withholdingVatAmount: num(r.vat),
  withholdingIsAmount: num(r.is_amount),
  netPayable: num(r.net),
});

export async function withholdingsSummary(from: string, to: string, clientId: number | null): Promise<FinanceWithholdingsResponse> {
  // Facture déposée = retenues figées (`net_payable` renseigné en même temps que `deposited_at`).
  const scope = sql`
    FROM client_invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.deposited_at BETWEEN ${from}::date AND ${to}::date
      AND i.net_payable IS NOT NULL
      AND i.status <> ${CANCELLED_CLIENT_INVOICE_STATUS}
      ${clientId === null ? sql`` : sql`AND i.client_id = ${clientId}`}`;
  const sums = sql`count(*)::int AS count, sum(i.amount_ht)::text AS amount_ht, sum(i.amount_ttc)::text AS amount_ttc,
    sum(i.withholding_vat_amount)::text AS vat, sum(i.withholding_is_amount)::text AS is_amount, sum(i.net_payable)::text AS net`;

  const [lines, groups, total] = await Promise.all([
    db.execute(sql`
      SELECT i.id, i.invoice_number, c.id AS client_id, c.name AS client_name, i.deposited_at::text AS deposited_at,
             i.amount_ht::text AS amount_ht, i.amount_ttc::text AS amount_ttc, i.withholding_vat_amount::text AS vat,
             i.withholding_is_amount::text AS is_amount, i.net_payable::text AS net
      ${scope}
      ORDER BY i.deposited_at, i.invoice_number, i.id`),
    db.execute(sql`SELECT c.id AS client_id, c.name AS client_name, ${sums} ${scope} GROUP BY c.id, c.name ORDER BY c.name NULLS LAST, c.id`),
    db.execute(sql`SELECT ${sums} ${scope}`),
  ]);

  type LineRow = AmountRow & { id: number; invoice_number: string; client_id: number | null; client_name: string | null; deposited_at: string };
  const items: FinanceWithholdingLine[] = rowsOf<LineRow>(lines).map((r) => ({
    invoiceId: r.id,
    invoiceNumber: r.invoice_number,
    clientId: r.client_id,
    clientName: r.client_name,
    depositedAt: r.deposited_at,
    amountHt: num(r.amount_ht),
    amountTtc: num(r.amount_ttc),
    withholdingVatAmount: num(r.vat),
    withholdingIsAmount: num(r.is_amount),
    netPayable: num(r.net),
  }));
  const byClient = rowsOf<AmountRow & { client_id: number | null; client_name: string | null }>(groups).map((r) => ({
    clientId: r.client_id,
    clientName: r.client_name,
    ...amounts(r),
  }));
  return { from, to, clientId, items, byClient, totals: amounts(rowsOf<AmountRow>(total)[0]) };
}
