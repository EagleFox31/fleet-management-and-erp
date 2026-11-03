import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { formatReportCell, renderReport, sheetName, type ReportDefinition } from "../../../server/lib/report-export";

const def: ReportDefinition = {
  title: "Indicateurs de pilotage",
  subtitle: "Octobre 2026",
  sections: [
    {
      title: "Coûts atelier",
      columns: [
        { header: "Véhicule", key: "vehicle" },
        { header: "Pannes", key: "breakdowns", kind: "integer" },
        { header: "Coût", key: "cost", kind: "amount" },
        { header: "Heures", key: "hours", kind: "decimal" },
        { header: "Part préventif", key: "share", kind: "percent" },
      ],
      rows: [
        { vehicle: "LT-123-AB", breakdowns: 3, cost: 1250000, hours: 12.5, share: 0.25 },
        { vehicle: "Un libellé de véhicule très long, bien au-delà de soixante caractères en tout", breakdowns: null, cost: null, hours: null, share: null },
      ],
      note: "Coûts en FCFA HT.",
    },
  ],
};

function readBack(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellNF: true, cellStyles: true });
  return wb.Sheets[wb.SheetNames[0]];
}

describe("rapport KPI en Excel : formats et largeurs", () => {
  const sheet = readBack(renderReport(def, "xlsx"));
  const cell = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })];

  it("chaque colonne numérique porte son format (cell.z) sur les lignes de données", () => {
    // Ligne 0 titre, 1 sous-titre, 2 section, 3 en-têtes : les données commencent ligne 4.
    expect(cell(4, 1).z).toBe("#,##0");
    expect(cell(4, 2).z).toBe("#,##0");
    expect(cell(4, 3).z).toBe("#,##0.00");
    expect(cell(4, 4).z).toBe("0.0%");
    expect(cell(4, 4).v).toBe(0.25);
  });

  it("le texte et les en-têtes ne reçoivent aucun format numérique", () => {
    expect(cell(4, 0).t).toBe("s");
    expect(cell(3, 2).v).toBe("Coût");
    expect(cell(3, 2).z ?? "General").toBe("General");
  });

  it("une valeur absente reste une cellule vide, jamais un zéro", () => {
    for (let c = 1; c <= 4; c++) expect(cell(5, c)?.v ?? null).toBeNull();
  });

  it("la note suit le tableau après une ligne vide", () => {
    expect(cell(7, 0).v).toBe("Coûts en FCFA HT.");
  });

  it("une largeur par colonne (!cols), bornée à 60 et au moins l'en-tête + 2", () => {
    const cols = sheet["!cols"] ?? [];
    expect(cols).toHaveLength(5);
    expect(cols[0].wch).toBe(60);
    expect(cols[1].wch).toBe("Pannes".length + 2);
    expect(cols[2].wch).toBe(formatReportCell(1250000, "amount").length + 2);
    expect(cols[4].wch).toBe("Part préventif".length + 2);
  });

  it("un rapport sans section produit quand même une feuille", () => {
    const wb = XLSX.read(renderReport({ title: "Vide", sections: [] }, "xlsx"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Vide"]);
  });
});

describe("rapport KPI : helpers", () => {
  it("formatReportCell : null en tiret, milliers en espace, pourcentage à virgule", () => {
    expect(formatReportCell(null, "amount")).toBe("-");
    expect(formatReportCell(1250000, "amount")).toBe("1 250 000");
    expect(formatReportCell(-1500.6, "integer")).toBe("-1 501");
    expect(formatReportCell(1234.5, "decimal")).toBe("1 234,50");
    expect(formatReportCell(0.125, "percent")).toBe("12,5 %");
  });

  it("sheetName : 31 caractères, sans caractère interdit, unique sans tenir compte de la casse", () => {
    const used = new Set<string>();
    expect(sheetName("Coûts [atelier]: 2026/10", used)).toBe("Coûts atelier 2026 10");
    expect(sheetName("COÛTS ATELIER 2026 10", used)).toBe("COÛTS ATELIER 2026 10 2");
    expect(sheetName("x".repeat(40), used)).toHaveLength(31);
    expect(sheetName("", used)).toBe("Feuille");
  });

  it("le PDF est un document PDF", () => {
    expect(renderReport(def, "pdf").subarray(0, 5).toString()).toBe("%PDF-");
  });
});
