/**
 * Contrat de l'import Excel des factures fournisseur
 * (`POST /api/supplier-invoices/import`). Valeurs lues par le serveur (le client ne les importe pas ; les afficher à l'écran
 * demandera de les importer depuis ce fichier, jamais de les recopier).
 */

/** Nombre maximal de lignes de données (hors en-tête) acceptées dans un fichier. */
export const SUPPLIER_INVOICE_IMPORT_MAX_ROWS = 5000;

/** Taille maximale du fichier téléversé (octets). */
export const SUPPLIER_INVOICE_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Taille décompressée maximale du classeur (octets), mesurée en décompressant réellement chaque entrée du zip. */
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
