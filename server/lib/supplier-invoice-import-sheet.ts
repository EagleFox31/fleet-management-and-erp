import * as XLSX from "xlsx";
import { AppError } from "./app-error";
import {
  SUPPLIER_INVOICE_IMPORT_COLUMNS,
  SUPPLIER_INVOICE_IMPORT_MAX_ROWS,
  SUPPLIER_INVOICE_IMPORT_REQUIRED_COLUMNS,
} from "../../shared/contracts/supplier-invoice-import";

/**
 * Extraction de la feuille d'import des factures fournisseur (`POST /api/supplier-invoices/import`),
 * lue par SheetJS en mode dense. Chaque passe est bornée par les cellules présentes, jamais par
 * l'étendue déclarée ni par la largeur d'une ligne.
 */

export function isBlankCell(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

/** Dernière ligne adressable d'une feuille Excel (indice 0). */
const EXCEL_LAST_ROW_INDEX = 1_048_575;

type DenseRow = Array<XLSX.CellObject | undefined>;

export function importTooLongError(found: string): AppError {
  return new AppError(
    400,
    `Fichier trop long : ${found}, ${SUPPLIER_INVOICE_IMPORT_MAX_ROWS} lignes de données maximum. Découpez-le en plusieurs fichiers.`,
  );
}

/**
 * Colonnes attendues de la ligne d'en-tête (première occurrence de chaque nom), ou `null` si la
 * ligne est blanche. `for…in` n'énumère que les cellules présentes : une cellule isolée en XFD
 * ne fait pas parcourir 16 384 indices.
 */
function headerColumns(cells: DenseRow): Array<{ column: number; cell: XLSX.CellObject }> | null {
  const expected = new Set<string>(SUPPLIER_INVOICE_IMPORT_COLUMNS);
  const columns: Array<{ column: number; cell: XLSX.CellObject }> = [];
  let blank = true;
  for (const key in cells) {
    const cell = cells[key as unknown as number];
    if (!cell || isBlankCell(cell.v)) continue;
    blank = false;
    const name = cell.w ?? String(cell.v);
    if (!expected.has(name)) continue;
    expected.delete(name);
    columns.push({ column: Number(key), cell });
  }
  return blank ? null : columns;
}

/** Refuse un en-tête qui ne porte aucune colonne attendue, ou auquel manque une colonne obligatoire. */
function assertHeader(columns: Array<{ cell: XLSX.CellObject }>): void {
  if (columns.length === 0) {
    throw new AppError(400, `En-têtes introuvables : la première ligne doit contenir les colonnes ${SUPPLIER_INVOICE_IMPORT_COLUMNS.join(", ")}.`);
  }
  const found = new Set(columns.map(({ cell }) => cell.w ?? String(cell.v)));
  const missing = SUPPLIER_INVOICE_IMPORT_REQUIRED_COLUMNS.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new AppError(
      400,
      `Colonnes obligatoires absentes de l'en-tête : ${missing.join(", ")}. Vérifiez leur orthographe et leurs accents.`,
    );
  }
}

/**
 * Feuille compacte à donner à `sheet_to_json` : l'en-tête et les seules lignes de données non
 * vides, réduites aux colonnes attendues. Chaque passe est bornée par les cellules présentes, jamais
 * par l'étendue déclarée (`<dimension>`) ni par la largeur d'une ligne :
 * - hauteur : `length` du tableau dense (O(1)), refusée au-delà de la dernière ligne d'Excel ;
 * - en-tête : cellules présentes de la première ligne non blanche, refusé s'il manque une colonne
 *   obligatoire ;
 * - lignes de données : accès direct aux colonnes attendues (8 au plus), refus au-delà de 5000.
 * Le nombre de lignes présentes n'est pas plafonné : une feuille à formules tirées porte des
 * milliers de lignes calculées vides, et la décompression (plafonnée à 15 Mo) a déjà payé leur coût.
 * Une ligne qui ne porte rien dans les colonnes attendues est écartée comme une ligne blanche
 * (comme `sheet_to_json`) ; les cellules des autres colonnes sont ignorées.
 */
export function compactImportSheet(worksheet: XLSX.WorkSheet): XLSX.WorkSheet | null {
  const rows = (worksheet["!data"] ?? []) as Array<DenseRow | undefined>;
  if (rows.length - 1 > EXCEL_LAST_ROW_INDEX) {
    throw new AppError(400, "Fichier Excel invalide : ligne au-delà de la limite d'Excel (1 048 576).");
  }
  let columns: Array<{ column: number; cell: XLSX.CellObject }> | null = null;
  const dataRows: DenseRow[] = [];
  let dataCount = 0;
  for (const key in rows) {
    const cells = rows[Number(key)];
    if (!Array.isArray(cells)) continue;
    if (columns === null) {
      columns = headerColumns(cells);
      if (columns !== null) assertHeader(columns);
      continue;
    }
    const picked = columns.map(({ column }) => cells[column]);
    if (picked.every((cell) => !cell || isBlankCell(cell.v))) continue;
    // Au-delà du maximum, on ne garde plus rien mais on finit de compter (8 accès par ligne au
    // plus) pour donner le nombre exact dans le refus.
    if (++dataCount <= SUPPLIER_INVOICE_IMPORT_MAX_ROWS) dataRows.push(picked);
  }
  if (dataCount > SUPPLIER_INVOICE_IMPORT_MAX_ROWS) {
    throw importTooLongError(`${dataCount} lignes de données trouvées`);
  }
  if (columns === null) return null;
  const compact: XLSX.WorkSheet = {};
  // Cellule absente = `undefined`, que `sheet_to_json` saute comme un trou du tableau dense.
  compact["!data"] = [columns.map(({ cell }) => cell), ...dataRows] as XLSX.CellObject[][];
  compact["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataRows.length, c: columns.length - 1 } });
  return compact;
}
