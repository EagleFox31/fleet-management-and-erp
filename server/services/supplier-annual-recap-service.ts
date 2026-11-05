/**
 * Récapitulatif annuel des factures fournisseurs (contrat `shared/contracts/supplier-annual-recap.ts`).
 * Une seule requête (fournisseur × mois) : mois, fournisseurs et totaux viennent du même instantané.
 * Postgres somme en numeric par cellule ; les agrégats en centimes entiers : aucune dérive flottante.
 */
import { sql } from "drizzle-orm";
import type { SupplierAnnualRecapResponse, SupplierRecapAmounts } from "@shared/contracts/supplier-annual-recap";
import { db } from "../db";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

interface CellRow {
  supplier_id: number | null;
  supplier_name: string | null;
  month: number | string;
  count: number | string;
  ht: string | null;
  vat: string | null;
  ttc: string | null;
  outstanding: string | null;
  disputed_count: number | string;
  disputed_ttc: string | null;
}

/** Montants en centimes entiers pendant l'agrégation. */
interface Cents {
  count: number;
  ht: number;
  vat: number;
  ttc: number;
  outstanding: number;
  disputedCount: number;
  disputedTtc: number;
}

const cents = (v: string | null): number => (v === null ? 0 : Math.round(Number(v) * 100));
const zero = (): Cents => ({ count: 0, ht: 0, vat: 0, ttc: 0, outstanding: 0, disputedCount: 0, disputedTtc: 0 });

function add(into: Cents, r: CellRow): void {
  into.count += Number(r.count);
  into.ht += cents(r.ht);
  into.vat += cents(r.vat);
  into.ttc += cents(r.ttc);
  into.outstanding += cents(r.outstanding);
  into.disputedCount += Number(r.disputed_count);
  into.disputedTtc += cents(r.disputed_ttc);
}

const amounts = (c: Cents): SupplierRecapAmounts => ({
  count: c.count,
  amountHt: c.ht / 100,
  vatAmount: c.vat / 100,
  amountTtc: c.ttc / 100,
  outstandingAsOfToday: c.outstanding / 100,
  disputedCount: c.disputedCount,
  disputedAmountTtc: c.disputedTtc / 100,
});

const twelve = (): Cents[] => Array.from({ length: 12 }, zero);
const monthsOf = (m: Cents[]) => m.map((c, i) => ({ month: i + 1, ...amounts(c) }));

export async function supplierAnnualRecap(year: number, supplierId: number | null): Promise<SupplierAnnualRecapResponse> {
  const storedTtc = sql`coalesce(i.total_ttc, i.total_amount)`;
  // TVA absente mais TTC présent : déduite (TTC − HT) pour que HT + TVA = TTC.
  const vat = sql`coalesce(i.vat_amount, i.tax_amount, ${storedTtc} - i.amount_ht, 0)`;
  const ttc = sql`coalesce(${storedTtc}, i.amount_ht + ${vat})`;
  const month = sql`extract(month FROM i.invoice_date)::int`;

  const result = await db.execute(sql`
    SELECT s.id AS supplier_id, s.name AS supplier_name, ${month} AS month,
      count(*)::int AS count, sum(i.amount_ht)::text AS ht, sum(${vat})::text AS vat, sum(${ttc})::text AS ttc,
      sum(coalesce(i.balance, 0))::text AS outstanding,
      count(*) FILTER (WHERE i.status = 'disputed')::int AS disputed_count,
      sum(${ttc}) FILTER (WHERE i.status = 'disputed')::text AS disputed_ttc
    FROM supplier_invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.invoice_date BETWEEN make_date(${year}::int, 1, 1) AND make_date(${year}::int, 12, 31)
      ${supplierId === null ? sql`` : sql`AND i.supplier_id = ${supplierId}`}
    GROUP BY s.id, s.name, ${month}
    ORDER BY s.name NULLS LAST, s.id NULLS LAST, ${month}`);

  const total = zero();
  const months = twelve();
  const suppliers = new Map<number | null, { name: string | null; total: Cents; months: Cents[] }>();
  for (const r of rowsOf<CellRow>(result)) {
    const m = Number(r.month) - 1;
    let entry = suppliers.get(r.supplier_id);
    if (!entry) {
      entry = { name: r.supplier_name, total: zero(), months: twelve() };
      suppliers.set(r.supplier_id, entry);
    }
    add(entry.total, r);
    add(entry.months[m], r);
    add(months[m], r);
    add(total, r);
  }

  return {
    year,
    supplierId,
    months: monthsOf(months),
    bySupplier: Array.from(suppliers, ([id, e]) => ({
      supplierId: id,
      supplierName: e.name,
      ...amounts(e.total),
      months: monthsOf(e.months),
    })),
    totals: amounts(total),
  };
}
