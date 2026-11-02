import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { compactImportSheet, IMPORT_MAX_PRESENT_ROWS } from "../../../server/lib/supplier-invoice-import-sheet";
import { SUPPLIER_INVOICE_IMPORT_COLUMNS, SUPPLIER_INVOICE_IMPORT_MAX_ROWS } from "../../../shared/contracts/supplier-invoice-import";

/**
 * Feuille d'import compacte : chaque passe est bornée par les cellules présentes,
 * jamais par la largeur d'une ligne (cellule en XFD) ni par l'étendue déclarée.
 */

const XFD = 16383;
type Cell = XLSX.CellObject | undefined;

const s = (v: string): XLSX.CellObject => ({ t: "s", v, w: v });
const n = (v: number): XLSX.CellObject => ({ t: "n", v });

function sheet(rows: Array<Cell[] | undefined>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  ws["!data"] = rows as XLSX.CellObject[][];
  ws["!ref"] = "A1:XFD1048576"; // étendue déclarée volontairement absurde : elle ne doit pas compter
  return ws;
}

/** Ligne dense comme SheetJS la construit : cellules posées une à une sur un tableau vide. */
function row(cells: Array<[number, XLSX.CellObject]>): Cell[] {
  const r: Cell[] = [];
  for (const [c, cell] of cells) r[c] = cell;
  return r;
}

const header = () => row(SUPPLIER_INVOICE_IMPORT_COLUMNS.map((name, c) => [c, s(name)]));

function refusal(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(400);
    return error as AppError;
  }
  throw new Error("aucun refus");
}

describe("compactImportSheet", () => {
  it("garde l'en-tête et les lignes non vides, réduites aux colonnes attendues", () => {
    const ws = sheet([
      row([[0, s("Numéro Facture")], [1, s("Inconnue")], [2, s("Fournisseur")], [5, s("Numéro Facture")]]),
      row([[0, s("F1")], [1, s("ignoré")], [2, s("ACME")], [5, s("doublon ignoré")]]),
      row([[0, s("   ")]]),
      undefined,
      row([[1, s("hors colonnes attendues")]]),
      row([[0, s("F2")]]),
    ]);
    const compact = compactImportSheet(ws)!;
    expect(XLSX.utils.sheet_to_json(compact)).toEqual([
      { "Numéro Facture": "F1", Fournisseur: "ACME" },
      { "Numéro Facture": "F2" },
    ]);
  });

  it("feuille sans cellule non blanche : rien à importer", () => {
    expect(compactImportSheet(sheet([row([[XFD, s(" ")]])]))).toBeNull();
  });

  it("en-tête sans aucune colonne attendue : 400 lisible", () => {
    expect(refusal(() => compactImportSheet(sheet([row([[0, s("Titre")]]), row([[0, s("x")]])]))).message).toMatch(/En-têtes introuvables/);
  });

  it(`exactement ${SUPPLIER_INVOICE_IMPORT_MAX_ROWS} lignes de données : accepté ; une de plus : 400 avec le nombre trouvé`, () => {
    const rows = [header(), ...Array.from({ length: SUPPLIER_INVOICE_IMPORT_MAX_ROWS }, (_, i) => row([[0, n(i)]]))];
    expect(XLSX.utils.sheet_to_json(compactImportSheet(sheet(rows))!)).toHaveLength(SUPPLIER_INVOICE_IMPORT_MAX_ROWS);
    rows.push(row([[0, n(-1)]]));
    expect(refusal(() => compactImportSheet(sheet(rows))).message).toMatch(`${SUPPLIER_INVOICE_IMPORT_MAX_ROWS + 1} lignes de données trouvées`);
  });

  it("ligne au-delà de 1 048 576 : 400", () => {
    const rows: Array<Cell[] | undefined> = [header()];
    rows[1_048_576] = row([[0, s("F")]]);
    expect(refusal(() => compactImportSheet(sheet(rows))).message).toMatch(/1 048 576/);
  });

  it(`plus de ${IMPORT_MAX_PRESENT_ROWS} lignes présentes, même blanches : 400 avant tout parcours de cellules`, () => {
    const rows = Array.from({ length: IMPORT_MAX_PRESENT_ROWS + 1 }, () => row([[XFD, s(" ")]]));
    expect(refusal(() => compactImportSheet(sheet(rows))).message).toMatch(`${IMPORT_MAX_PRESENT_ROWS + 1} lignes renseignées`);
  });

  it("lignes larges sous le plafond (cellules en XFD et tous les 1000) : temps borné par les cellules présentes", () => {
    const spaced = Array.from({ length: 17 }, (_, i) => Math.min(i * 1000, XFD));
    const blank = Array.from({ length: IMPORT_MAX_PRESENT_ROWS }, () => row(spaced.map((c) => [c, s(" ")])));
    const data = [header(), ...Array.from({ length: SUPPLIER_INVOICE_IMPORT_MAX_ROWS }, (_, i) => row([[0, n(i)], ...spaced.slice(1).map((c): [number, XLSX.CellObject] => [c, n(1)])]))];
    const started = performance.now();
    expect(compactImportSheet(sheet(blank))).toBeNull();
    expect(XLSX.utils.sheet_to_json(compactImportSheet(sheet(data))!)).toHaveLength(SUPPLIER_INVOICE_IMPORT_MAX_ROWS);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
