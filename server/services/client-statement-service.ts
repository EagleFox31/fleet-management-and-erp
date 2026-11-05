import { sql } from "drizzle-orm";
import type { ClientStatementLine, ClientStatementResponse } from "@shared/contracts/client-statement";
import { db } from "../db";

/**
 * Relevé de compte client (contrat `shared/contracts/client-statement.ts`).
 * Le solde courant est calculé en SQL (fenêtre sur toutes les écritures jusqu'à `to`), le solde
 * d'ouverture est donc celui de la veille de `from`, quelle que soit l'ancienneté de l'historique.
 */

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

const amount = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export const clientStatementService = {
  /** `null` : client inconnu. */
  async statement(clientId: number, from: string | null, to: string): Promise<ClientStatementResponse | null> {
    const clientRes = await db.execute(sql`SELECT id, name FROM clients WHERE id = ${clientId}`);
    const client = rowsOf<{ id: number; name: string }>(clientRes)[0];
    if (!client) return null;

    const res = await db.execute(sql`
      WITH movements AS (
        SELECT i.invoice_date AS d, 0 AS ord, i.id AS mid, i.id AS invoice_id, i.invoice_number,
               NULL::text AS reference, NULL::text AS payment_method,
               i.amount_ttc AS debit, 0::numeric AS credit
        FROM client_invoices i
        WHERE i.client_id = ${clientId} AND i.status <> 'cancelled'
        UNION ALL
        SELECT p.payment_date, 1, p.id, i.id, i.invoice_number,
               p.reference, p.payment_method,
               0::numeric, p.amount
        FROM client_payments p
        JOIN client_invoices i ON i.id = p.invoice_id
        WHERE i.client_id = ${clientId} AND i.status <> 'cancelled'
      ),
      ledger AS (
        SELECT m.*, SUM(m.debit - m.credit) OVER (ORDER BY m.d, m.ord, m.mid ROWS UNBOUNDED PRECEDING) AS running
        FROM movements m
        WHERE m.d <= ${to}::date
      )
      SELECT to_char(d, 'YYYY-MM-DD') AS d, ord, invoice_id, invoice_number, reference, payment_method,
             debit, credit, running,
             (d < ${from}::date) AS before_period
      FROM ledger
      ORDER BY d, ord, mid`);

    const rows = rowsOf<Record<string, unknown>>(res);
    let openingBalance = 0;
    const lines: ClientStatementLine[] = [];
    for (const r of rows) {
      if (r.before_period === true) {
        openingBalance = amount(r.running);
        continue;
      }
      lines.push({
        date: String(r.d),
        kind: Number(r.ord) === 0 ? "invoice" : "payment",
        invoiceId: Number(r.invoice_id),
        invoiceNumber: String(r.invoice_number),
        reference: (r.reference as string | null) ?? null,
        paymentMethod: (r.payment_method as ClientStatementLine["paymentMethod"]) ?? null,
        debit: amount(r.debit),
        credit: amount(r.credit),
        balance: amount(r.running),
      });
    }

    const totals = {
      debit: amount(lines.reduce((s, l) => s + l.debit, 0)),
      credit: amount(lines.reduce((s, l) => s + l.credit, 0)),
    };
    return {
      client: { id: Number(client.id), name: String(client.name) },
      from,
      to,
      openingBalance,
      lines,
      totals,
      closingBalance: lines.length > 0 ? lines[lines.length - 1].balance : openingBalance,
    };
  },
};
