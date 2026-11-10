import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { addDays, monthStart } from "../lib/kpi-rules";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { isIsoCalendarDate } from "@shared/constants/calendar-date";

/**
 * Chiffre d'affaires réel par client, lu sur les factures clients.
 *
 * Règles (lot « CA réel », décisions du 2026-11-09) :
 * - Facture émise = `status <> 'cancelled'`. L'enum n'a pas de brouillon ; s'il en apparaît un, il
 *   devra être exclu ici aussi.
 * - Montant HT (`amount_ht`), sommé en SQL `numeric` et rendu en chaîne décimale : jamais de float.
 * - Devise : `client_invoices` ne porte aucune devise, tous les montants sont supposés en FCFA.
 *   Une colonne devise imposerait de refuser le mélange avant de sommer.
 * - Avoirs : aucune table d'avoirs. Un montant HT négatif est sommé avec son signe (il réduit le CA,
 *   comme un avoir) et compté dans `negativeInvoiceCount` pour qu'un écran puisse le signaler.
 * - Client = `COALESCE(facture.client_id, mission.client_id)`. Une facture sans client ni mission
 *   forme la ligne « Sans client » (`clientId` et `clientName` null) : comptée dans le total.
 * - Période : `invoice_date` entre `from` et `to` inclus (dates calendaires).
 * - Coût connu = `actual_fuel_cost` des missions FACTURÉES de la période, compté UNE fois par mission
 *   même si plusieurs factures la portent (acompte + solde).
 * - Marge après carburant, par client : CA HT − coût connu ; null si une facture n'a pas de mission
 *   ou si une mission facturée n'a pas de coût carburant réel. Le total vaut null dès qu'un client l'est.
 */

export const MAX_REVENUE_PERIOD_DAYS = 366;

export type RevenuePeriod = { from: string; to: string };

export type ClientRevenueRow = {
  clientId: number | null;
  clientName: string | null;
  invoiceCount: number;
  negativeInvoiceCount: number;
  revenueHt: string;
  fuelCostKnown: string | null;
  marginAfterFuelHt: string | null;
};

export type ClientRevenueReport = RevenuePeriod & {
  rows: ClientRevenueRow[];
  totals: Omit<ClientRevenueRow, "clientId" | "clientName">;
};

/** Mois calendaire en cours à Douala. */
export function currentMonthPeriod(now: Date = new Date()): RevenuePeriod {
  const from = monthStart(isoDateInZone(now));
  return { from, to: addDays(monthStart(from, 1), -1) };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Période demandée. Les deux bornes ou aucune (mois en cours) ; une date inexistante, `from > to`
 * ou plus de 366 jours : 400 avec un message lisible.
 */
export function resolveRevenuePeriod(query: { from?: unknown; to?: unknown }, now: Date = new Date()): RevenuePeriod {
  const from = query.from === "" ? undefined : query.from;
  const to = query.to === "" ? undefined : query.to;
  if (from === undefined && to === undefined) return currentMonthPeriod(now);
  if (from === undefined || to === undefined) {
    throw new AppError(400, "Indiquez la date de début et la date de fin de la période.");
  }
  if (!isIsoCalendarDate(from)) throw new AppError(400, "Date de début invalide (format AAAA-MM-JJ).");
  if (!isIsoCalendarDate(to)) throw new AppError(400, "Date de fin invalide (format AAAA-MM-JJ).");
  if (from > to) throw new AppError(400, "La date de début doit précéder la date de fin.");
  if (daysBetween(from, to) > MAX_REVENUE_PERIOD_DAYS) {
    throw new AppError(400, `La période ne peut pas dépasser ${MAX_REVENUE_PERIOD_DAYS} jours.`);
  }
  return { from, to };
}

type SqlRow = {
  client_id: number | null;
  client_name: string | null;
  invoice_count: number | string;
  negative_count: number | string;
  revenue_ht: string;
  fuel_cost_known: string | null;
  margin: string | null;
};

const ZERO = "0.00";

/** Somme décimale exacte de chaînes `numeric` (centimes en BigInt) ; null si un terme l'est. */
function sumDecimals(values: readonly (string | null)[]): string | null {
  let cents = 0n;
  for (const value of values) {
    if (value === null) return null;
    const negative = value.startsWith("-");
    const [whole, frac = ""] = value.replace("-", "").split(".");
    const abs = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
    cents += negative ? -abs : abs;
  }
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Somme des seules valeurs connues ; null si aucune ne l'est. */
function sumKnownDecimals(values: readonly (string | null)[]): string | null {
  const known = values.filter((value): value is string => value !== null);
  return known.length === 0 ? null : sumDecimals(known);
}

export async function getRevenueByClient(period: RevenuePeriod): Promise<ClientRevenueReport> {
  const result = await db.execute(sql`
    WITH inv AS (
      SELECT i.id,
             i.mission_id,
             COALESCE(i.client_id, m.client_id) AS client_id,
             i.amount_ht,
             m.actual_fuel_cost
      FROM client_invoices i
      LEFT JOIN missions m ON m.id = i.mission_id
      WHERE i.status <> 'cancelled'
        AND i.invoice_date >= ${period.from}::date
        AND i.invoice_date <= ${period.to}::date
    ),
    per_client AS (
      SELECT client_id,
             COUNT(*) AS invoice_count,
             COUNT(*) FILTER (WHERE amount_ht < 0) AS negative_count,
             SUM(amount_ht) AS revenue_ht,
             BOOL_OR(mission_id IS NULL) AS has_invoice_without_mission
      FROM inv
      GROUP BY client_id
    ),
    -- Une mission portée par plusieurs factures (acompte + solde) ne compte son carburant qu'une fois.
    billed_missions AS (
      SELECT DISTINCT client_id, mission_id, actual_fuel_cost
      FROM inv
      WHERE mission_id IS NOT NULL
    ),
    fuel AS (
      SELECT client_id,
             SUM(actual_fuel_cost) AS fuel_cost_known,
             BOOL_OR(actual_fuel_cost IS NULL) AS has_unknown_fuel
      FROM billed_missions
      GROUP BY client_id
    )
    SELECT p.client_id,
           c.name AS client_name,
           p.invoice_count,
           p.negative_count,
           p.revenue_ht::numeric(18, 2)::text AS revenue_ht,
           f.fuel_cost_known::numeric(18, 2)::text AS fuel_cost_known,
           CASE
             WHEN p.has_invoice_without_mission OR COALESCE(f.has_unknown_fuel, false) THEN NULL
             ELSE (p.revenue_ht - COALESCE(f.fuel_cost_known, 0))::numeric(18, 2)::text
           END AS margin
    FROM per_client p
    LEFT JOIN fuel f ON f.client_id IS NOT DISTINCT FROM p.client_id
    LEFT JOIN clients c ON c.id = p.client_id
    ORDER BY p.client_id IS NULL, p.revenue_ht DESC, p.client_id
  `);

  const rows: ClientRevenueRow[] = (result.rows as SqlRow[]).map((row) => ({
    clientId: row.client_id === null ? null : Number(row.client_id),
    // « Sans client » : ni nom ni mission (décision C).
    clientName: row.client_id === null ? null : row.client_name,
    invoiceCount: Number(row.invoice_count),
    negativeInvoiceCount: Number(row.negative_count),
    revenueHt: row.revenue_ht,
    fuelCostKnown: row.fuel_cost_known,
    marginAfterFuelHt: row.margin,
  }));

  return {
    ...period,
    rows,
    totals: {
      invoiceCount: rows.reduce((sum, row) => sum + row.invoiceCount, 0),
      negativeInvoiceCount: rows.reduce((sum, row) => sum + row.negativeInvoiceCount, 0),
      revenueHt: sumDecimals(rows.map((row) => row.revenueHt)) ?? ZERO,
      fuelCostKnown: rows.length === 0 ? ZERO : sumKnownDecimals(rows.map((row) => row.fuelCostKnown)),
      marginAfterFuelHt: rows.length === 0 ? ZERO : sumDecimals(rows.map((row) => row.marginAfterFuelHt)),
    },
  };
}

export const clientRevenueService = { getRevenueByClient, resolveRevenuePeriod };
