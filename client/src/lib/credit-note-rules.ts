import { CREDIT_NOTE_WRITER_ROLES } from "@shared/constants/roles";

/** Facture vue par le bloc des avoirs : seuls les champs qui décident de l'émission et de l'aperçu. */
export type CreditableInvoice = {
  id: number;
  invoiceNumber: string;
  status: string;
  balance: string;
  vatRate: string;
  depositedAt?: string | null;
};

export const creditNotesKeyOf = (invoiceId: number) => `/api/billing/invoices/${invoiceId}/credit-notes`;

export const invoiceKeyOf = (invoiceId: number) => `/api/billing/invoices/${invoiceId}`;

export function canIssueCreditNote(role: string | null | undefined): boolean {
  return (CREDIT_NOTE_WRITER_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** Pourquoi la facture ne peut pas recevoir d'avoir, ou `null` si elle le peut. Mêmes règles que le serveur (409). */
export function creditNoteBlockerOf(invoice: CreditableInvoice): string | null {
  if (invoice.status === "cancelled") return "Facture annulée : elle ne peut plus recevoir d'avoir.";
  if (!(Number.parseFloat(invoice.balance || "0") > 0)) return "Facture soldée : un avoir ne peut pas dépasser le solde restant.";
  if (invoice.depositedAt) return "Facture déposée : l'avoir n'est pas encore possible, net à payer figé.";
  return null;
}
