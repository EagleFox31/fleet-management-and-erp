/**
 * Calcul de la balance âgée (contrat `shared/contracts/finance-receivables-aging.ts`).
 * Pur : partagé entre le serveur et les tests, sans accès base.
 */
import {
  AGING_BUCKETS,
  type AgingAmounts,
  type AgingBucket,
  type AgingRow,
  type FinanceReceivablesAgingResponse,
} from "../contracts/finance-receivables-aging";
import type { InvoiceAwaitingPayment } from "../contracts/invoices-awaiting-payment";

/** Tranche d'une facture : `null` (non déposée) → `notDeposited` ; bornes 30, 60, 90 incluses. */
export function agingBucketOf(daysSinceDeposit: number | null): AgingBucket {
  if (daysSinceDeposit === null) return "notDeposited";
  if (daysSinceDeposit <= 30) return "days0to30";
  if (daysSinceDeposit <= 60) return "days31to60";
  if (daysSinceDeposit <= 90) return "days61to90";
  return "over90";
}

interface Cents {
  count: number;
  ttc: number;
  net: number;
}

type CentsRow = Record<AgingBucket | "total", Cents>;

const toCents = (v: number): number => Math.round(v * 100);

function emptyRow(): CentsRow {
  const row = { total: { count: 0, ttc: 0, net: 0 } } as CentsRow;
  for (const b of AGING_BUCKETS) row[b] = { count: 0, ttc: 0, net: 0 };
  return row;
}

function addItem(row: CentsRow, bucket: AgingBucket, item: InvoiceAwaitingPayment): void {
  for (const cell of [row[bucket], row.total]) {
    cell.count += 1;
    cell.ttc += toCents(item.amountTtc);
    cell.net += toCents(item.netPayable);
  }
}

const amounts = (c: Cents): AgingAmounts => ({ count: c.count, amountTtc: c.ttc / 100, netPayable: c.net / 100 });

function toRow(row: CentsRow): AgingRow {
  return {
    notDeposited: amounts(row.notDeposited),
    days0to30: amounts(row.days0to30),
    days31to60: amounts(row.days31to60),
    days61to90: amounts(row.days61to90),
    over90: amounts(row.over90),
    total: amounts(row.total),
  };
}

/** Répartit les factures en attente par client et par tranche ; clients triés par nom, sans client en dernier. */
export function buildReceivablesAging(items: InvoiceAwaitingPayment[], asOf: string): FinanceReceivablesAgingResponse {
  const totals = emptyRow();
  const clients = new Map<number | null, { name: string | null; row: CentsRow }>();
  for (const item of items) {
    const bucket = agingBucketOf(item.daysSinceDeposit);
    let entry = clients.get(item.clientId);
    if (!entry) {
      entry = { name: item.clientName, row: emptyRow() };
      clients.set(item.clientId, entry);
    }
    addItem(entry.row, bucket, item);
    addItem(totals, bucket, item);
  }
  const byClient = Array.from(clients, ([clientId, e]) => ({ clientId, clientName: e.name, ...toRow(e.row) })).sort(
    (a, b) => {
      if (a.clientId === null || b.clientId === null) return a.clientId === null ? (b.clientId === null ? 0 : 1) : -1;
      return (a.clientName ?? "").localeCompare(b.clientName ?? "", "fr") || a.clientId - b.clientId;
    },
  );
  return { asOf, byClient, totals: toRow(totals) };
}
