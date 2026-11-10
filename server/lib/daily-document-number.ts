import { sql } from "drizzle-orm";

/** Exécuteur Drizzle d'une transaction (`db.transaction(async (tx) => ...)`). */
type Tx = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => {
  if (Array.isArray(res)) return res as Row[];
  const rows = (res as { rows?: Row[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
};

export type DailyNumberSpec = {
  /** Préfixe du document : `FACT`, `AV`. */
  prefix: string;
  /** Table et colonne qui portent le numéro (identifiants fixes du code, jamais une valeur de requête). */
  table: string;
  column: string;
  /** Clé du verrou consultatif (par jour) : deux transactions concurrentes ne tirent pas le même numéro. */
  lockScope: string;
};

/** Numéros de facture : `FACT-AAAAMMJJ-NNN`, verrou `invoice-<date>` (comportement historique, inchangé). */
export const INVOICE_NUMBER_SPEC: DailyNumberSpec = {
  prefix: "FACT",
  table: "client_invoices",
  column: "invoice_number",
  lockScope: "invoice",
};

/** Numéros d'avoir : `AV-AAAAMMJJ-NNN`, verrou propre `credit-note-<date>`. */
export const CREDIT_NOTE_NUMBER_SPEC: DailyNumberSpec = {
  prefix: "AV",
  table: "client_credit_notes",
  column: "credit_note_number",
  lockScope: "credit-note",
};

/** Jour du numéro : date UTC (AAAAMMJJ), comme la numérotation des factures l'a toujours fait. */
export function dailyNumberDateOf(now: Date = new Date()): string {
  return now.toISOString().split("T")[0].replace(/-/g, "");
}

/**
 * Prochain numéro du jour `<PREFIX>-AAAAMMJJ-NNN`. À appeler dans la transaction qui insère le document :
 * le verrou consultatif du jour est tenu jusqu'à son COMMIT, le dernier numéro est relu sous ce verrou.
 */
export async function nextDailyNumber(tx: Tx, spec: DailyNumberSpec, now: Date = new Date()): Promise<string> {
  const dateStr = dailyNumberDateOf(now);

  // Verrou du jour (couvre aussi « première pièce du jour », où il n'y a encore aucune ligne à verrouiller).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${spec.lockScope}-${dateStr}`}))`);

  const column = sql.identifier(spec.column);
  const res = await tx.execute(
    sql`SELECT ${column} AS number FROM ${sql.identifier(spec.table)}
        WHERE ${column} LIKE ${`${spec.prefix}-${dateStr}-%`}
        ORDER BY ${column} DESC LIMIT 1`,
  );
  const last = rowsOf(res)[0]?.number;

  let sequence = 1;
  if (typeof last === "string") {
    sequence = parseInt(last.split("-").pop() || "0") + 1;
  }
  return `${spec.prefix}-${dateStr}-${sequence.toString().padStart(3, "0")}`;
}
