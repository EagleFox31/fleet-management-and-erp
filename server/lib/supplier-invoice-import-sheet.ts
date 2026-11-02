import * as XLSX from "xlsx";
import { AppError } from "./app-error";
import { SUPPLIER_INVOICE_IMPORT_COLUMNS, SUPPLIER_INVOICE_IMPORT_MAX_ROWS } from "../../shared/contracts/supplier-invoice-import";

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

/**
 * Plafond des lignes présentes dans la feuille (lignes portant au moins une cellule, même blanche),
 * vérifié avant tout parcours de cellules : en-tête + 5000 lignes de données laissent environ
 * 5000 lignes de marge pour des lignes d'espaces ou de chaînes vides. Au-delà, le fichier n'est
 * pas un import de factures et son parcours n'a pas à être payé.
 */
export const IMPORT_MAX_PRESENT_ROWS = 2 * SUPPLIER_INVOICE_IMPORT_MAX_ROWS;

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

/**
 * Feuille compacte à donner à `sheet_to_json` : l'en-tête et les seules lignes de données non
 * vides, réduites aux colonnes attendues. Chaque passe est bornée par les cellules présentes, jamais
 * par l'étendue déclarée (`<dimension>`) ni par la largeur d'une ligne :
 * - hauteur : `length` du tableau dense (O(1)) puis nombre de lignes présentes, refusé au-delà de
 *   `IMPORT_MAX_PRESENT_ROWS` avant de lire une cellule ;
 * - en-tête : cellules présentes de la première ligne non blanche ;
 * - lignes de données : accès direct aux colonnes attendues (8 au plus), refus au-delà de 5000.
 * Les lignes blanches sont écartées (comme `sheet_to_json`), aucune ligne n'est perdue en silence.
 */
export function compactImportSheet(worksheet: XLSX.WorkSheet): XLSX.WorkSheet | null {
  const rows = (worksheet["!data"] ?? []) as Array<DenseRow | undefined>;
  if (rows.length - 1 > EXCEL_LAST_ROW_INDEX) {
    throw new AppError(400, "Fichier Excel invalide : ligne au-delà de la limite d'Excel (1 048 576).");
  }
  const present = Object.keys(rows);
  if (present.length > IMPORT_MAX_PRESENT_ROWS) {
    throw importTooLongError(`${present.length} lignes renseignées trouvées`);
  }
  let columns: Array<{ column: number; cell: XLSX.CellObject }> | null = null;
  const dataRows: DenseRow[] = [];
  let dataCount = 0;
  for (const key of present) {
    const cells = rows[Number(key)];
    if (!Array.isArray(cells)) continue;
    if (columns === null) {
      columns = headerColumns(cells);
      continue;
    }
    const picked = columns.map(({ column }) => cells[column]);
    if (picked.every((cell) => !cell || isBlankCell(cell.v))) continue;
    // Au-delà du maximum, on ne garde plus rien mais on finit de compter (8 accès par ligne au
    // plus, lignes présentes déjà plafonnées) pour donner le nombre exact dans le refus.
    if (++dataCount <= SUPPLIER_INVOICE_IMPORT_MAX_ROWS) dataRows.push(picked);
  }
  if (dataCount > SUPPLIER_INVOICE_IMPORT_MAX_ROWS) {
    throw importTooLongError(`${dataCount} lignes de données trouvées`);
  }
  if (columns === null) return null;
  if (columns.length === 0) {
    throw new AppError(400, `En-têtes introuvables : la première ligne doit contenir les colonnes ${SUPPLIER_INVOICE_IMPORT_COLUMNS.join(", ")}.`);
  }
  const compact: XLSX.WorkSheet = {};
  // Cellule absente = `undefined`, que `sheet_to_json` saute comme un trou du tableau dense.
  compact["!data"] = [columns.map(({ cell }) => cell), ...dataRows] as XLSX.CellObject[][];
  compact["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataRows.length, c: columns.length - 1 } });
  return compact;
}
