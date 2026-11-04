/** Contrat de GET /api/supplier-invoices/discrepancies (écran des écarts de rapprochement). */
export const SUPPLIER_INVOICE_DISCREPANCIES_PATH = "/api/supplier-invoices/discrepancies";

export interface DiscrepancyInvoice {
  invoiceId: number;
  invoiceNumber: string;
  supplierName: string;
  varianceAmount: number;
  variancePercentage: number;
  orderNumber?: string;
  // Champs lus par l'écran (lien « Examiner », montant, date, statut).
  // `invoiceId` et `orderNumber` restent consommés par d'autres lecteurs.
  id: number;
  supplierId: number | null;
  invoiceDate: string;
  totalAmountTTC: number;
  status: string;
  purchaseOrderNumber?: string;
}

export interface DiscrepancyResult {
  escalatedCount: number;
  totalDiscrepancyAmount: number;
  averageVariance: number;
  discrepancies: DiscrepancyInvoice[];
}
