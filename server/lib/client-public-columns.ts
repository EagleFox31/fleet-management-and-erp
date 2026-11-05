import { getTableColumns } from "drizzle-orm";
import { clientInvoices, clients, type ClientInvoice } from "@shared/schema";

/**
 * Champs finance (lot F1) : taux de retenue du client, retenues et net figés de la facture.
 * Ils ne sortent que par le service finance (`/api/finance/...`) ou, pour la fiche client,
 * vers les rôles de lecture finance. Partout ailleurs, lire par les projections publiques.
 */
export const CLIENT_FINANCE_FIELDS = [
  "withholdingVatRate",
  "withholdingIsRate",
  "withholdingIsBase",
  "withholdingUpdatedBy",
] as const;

export const CLIENT_INVOICE_FINANCE_FIELDS = [
  "withholdingVatAmount",
  "withholdingIsAmount",
  "netPayable",
  "depositedBy",
] as const;

function omitKeys<T extends Record<string, unknown>, K extends keyof T>(source: T, keys: readonly K[]): Omit<T, K> {
  const copy: Record<string, unknown> = { ...source };
  for (const key of keys) delete copy[key as string];
  return copy as Omit<T, K>;
}

/** Colonnes de `clients` sans les champs finance : à passer à `select()` / `returning()`. */
export const publicClientColumns = omitKeys(getTableColumns(clients), CLIENT_FINANCE_FIELDS);

/** Colonnes de `client_invoices` sans les retenues ni le net figés. */
export const publicClientInvoiceColumns = omitKeys(getTableColumns(clientInvoices), CLIENT_INVOICE_FINANCE_FIELDS);

export type PublicClientInvoice = Omit<ClientInvoice, (typeof CLIENT_INVOICE_FINANCE_FIELDS)[number]>;

export function withoutClientFinanceFields<T extends Record<string, unknown>>(
  client: T,
): Omit<T, (typeof CLIENT_FINANCE_FIELDS)[number]> {
  return omitKeys(client, CLIENT_FINANCE_FIELDS as readonly (keyof T)[]) as Omit<T, (typeof CLIENT_FINANCE_FIELDS)[number]>;
}
