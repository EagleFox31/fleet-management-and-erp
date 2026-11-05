/**
 * Récapitulatif annuel des factures fournisseurs (contrat `shared/contracts/supplier-annual-recap.ts`).
 * Sommes faites en numeric par Postgres, renvoyées en texte : aucune dérive flottante.
 */
import { sql } from "drizzle-orm";
import type { SupplierAnnualRecapResponse, SupplierRecapAmounts } from "@shared/contracts/supplier-annual-recap";
import { db } from "../db";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

interface AmountRow {
  count: number | string;
  ht: string | null;
  vat: string | null;
  ttc: string | null;
  outstanding: string | null;
  disputed_count: number | string;
  disputed_ttc: string | null;
}

const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

const amounts = (r: AmountRow | undefined): SupplierRecapAmounts => ({
  count: Number(r?.count ?? 0),
  amountHt: num(r?.ht ?? null),
  vatAmount: num(r?.vat ?? null),
  amountTtc: num(r?.ttc ?? null),
  outstandingAsOfToday: num(r?.outstanding ?? null),
  disputedCount: Number(r?.disputed_count ?? 0),
  disputedAmountTtc: num(r?.disputed_ttc ?? null),
});

const twelveMonths = (rows: Array<AmountRow & { month: number | string }>) =>
  Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...amounts(rows.find((r) => Number(r.month) === i + 1)) }));

export async function supplierAnnualRecap(year: number, supplierId: number | null): Promise<SupplierAnnualRecapResponse> {
  const vat = sql`coalesce(i.vat_amount, i.tax_amount, 0)`;
  const ttc = sql`coalesce(i.total_ttc, i.total_amount, i.amount_ht + ${vat})`;
  const scope = sql`
    FROM supplier_invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.invoice_date BETWEEN make_date(${year}::int, 1, 1) AND make_date(${year}::int, 12, 31)
      ${supplierId === null ? sql`` : sql`AND i.supplier_id = ${supplierId}`}`;
  const sums = sql`count(*)::int AS count, sum(i.amount_ht)::text AS ht, sum(${vat})::text AS vat, sum(${ttc})::text AS ttc,
    sum(coalesce(i.balance, 0))::text AS outstanding,
    count(*) FILTER (WHERE i.status = 'disputed')::int AS disputed_count,
    sum(${ttc}) FILTER (WHERE i.status = 'disputed')::text AS disputed_ttc`;
  const month = sql`extract(month FROM i.invoice_date)::int`;

  const [bySupplierMonth, bySupplier, byMonth, total] = await Promise.all([
    db.execute(sql`SELECT s.id AS supplier_id, ${month} AS month, ${sums} ${scope} GROUP BY s.id, ${month}`),
    db.execute(sql`SELECT s.id AS supplier_id, s.name AS supplier_name, ${sums} ${scope} GROUP BY s.id, s.name ORDER BY s.name NULLS LAST, s.id`),
    db.execute(sql`SELECT ${month} AS month, ${sums} ${scope} GROUP BY ${month}`),
    db.execute(sql`SELECT ${sums} ${scope}`),
  ]);

  type MonthRow = AmountRow & { month: number | string };
  const cells = rowsOf<MonthRow & { supplier_id: number | null }>(bySupplierMonth);
  return {
    year,
    supplierId,
    months: twelveMonths(rowsOf<MonthRow>(byMonth)),
    bySupplier: rowsOf<AmountRow & { supplier_id: number | null; supplier_name: string | null }>(bySupplier).map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      ...amounts(r),
      months: twelveMonths(cells.filter((c) => c.supplier_id === r.supplier_id)),
    })),
    totals: amounts(rowsOf<AmountRow>(total)[0]),
  };
}
