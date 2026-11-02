/**
 * Contrat de l'import Excel des factures fournisseur
 * (`POST /api/supplier-invoices/import`). Valeurs partagées serveur / écran.
 */

/** Nombre maximal de lignes de données (hors en-tête) acceptées dans un fichier. */
export const SUPPLIER_INVOICE_IMPORT_MAX_ROWS = 5000;

/** Taille maximale du fichier téléversé (octets). */
export const SUPPLIER_INVOICE_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Taille décompressée maximale du classeur (octets), lue dans le répertoire central du zip. */
export const SUPPLIER_INVOICE_IMPORT_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Seules colonnes lues : toute autre colonne du fichier est ignorée. */
export const SUPPLIER_INVOICE_IMPORT_COLUMNS = [
  "Numéro Facture",
  "Fournisseur",
  "Date Facture",
  "Date Échéance",
  "Montant HT",
  "TVA (%)",
  "Montant TTC",
  "N° Commande",
] as const;

export type SupplierInvoiceImportColumn = (typeof SUPPLIER_INVOICE_IMPORT_COLUMNS)[number];
