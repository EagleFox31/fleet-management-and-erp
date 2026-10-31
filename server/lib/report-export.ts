/**
 * Export tabulaire réutilisable : des sections à colonnes déclarées, rendues en classeur Excel
 * (une feuille par section) ou en PDF (un tableau par section). Aucune règle métier ici : le
 * service qui construit le rapport fournit titres, colonnes et lignes.
 *
 * Les montants sont des FCFA entiers, les parts des fractions entre 0 et 1 (rendues en pourcentage).
 * Une valeur absente (`null`) reste une cellule vide en Excel et « - » en PDF : elle ne devient
 * jamais un zéro.
 */
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const REPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type ReportCell = string | number | null;

export type ReportColumn = {
  header: string;
  key: string;
  /** `text` par défaut. `amount` : FCFA entier. `percent` : fraction 0..1. `decimal` : deux décimales. */
  kind?: "text" | "integer" | "amount" | "decimal" | "percent";
};

export type ReportSection = {
  title: string;
  columns: readonly ReportColumn[];
  rows: readonly Record<string, ReportCell>[];
  /** Ligne d'explication sous le tableau (hypothèse, périmètre). */
  note?: string;
};

export type ReportDefinition = {
  title: string;
  subtitle?: string;
  sections: readonly ReportSection[];
};

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PDF_MIME = "application/pdf";

export function reportMimeType(format: ReportFormat): string {
  return format === "pdf" ? PDF_MIME : XLSX_MIME;
}

/** Séparateur de milliers en espace ordinaire : l'espace fine d'`Intl` est illisible dans la police PDF standard. */
function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatReportCell(value: ReportCell, kind: ReportColumn["kind"] = "text"): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  switch (kind) {
    case "percent":
      return `${(value * 100).toFixed(1).replace(".", ",")} %`;
    case "decimal": {
      const [int, dec] = value.toFixed(2).split(".");
      return `${groupThousands(int)},${dec}`;
    }
    case "integer":
    case "amount": {
      const rounded = Math.round(value);
      return `${rounded < 0 ? "-" : ""}${groupThousands(String(Math.abs(rounded)))}`;
    }
    default:
      return String(value);
  }
}

const NUMBER_FORMATS: Record<NonNullable<ReportColumn["kind"]>, string | undefined> = {
  text: undefined,
  integer: "#,##0",
  amount: "#,##0",
  decimal: "#,##0.00",
  percent: "0.0%",
};

/** Nom de feuille Excel : 31 caractères au plus, sans `[]:*?/\`, unique dans le classeur. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Feuille";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

function renderXlsx(def: ReportDefinition): Buffer {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  const sections: readonly ReportSection[] = def.sections.length > 0 ? def.sections : [{ title: def.title, columns: [], rows: [] }];
  for (const section of sections) {
    const aoa: ReportCell[][] = [[def.title], [def.subtitle ?? ""], [section.title], section.columns.map((c) => c.header)];
    for (const row of section.rows) aoa.push(section.columns.map((c) => row[c.key] ?? null));
    if (section.note) aoa.push([], [section.note]);
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const headerRow = 3;
    section.rows.forEach((_row, r) => {
      section.columns.forEach((col, c) => {
        const fmt = NUMBER_FORMATS[col.kind ?? "text"];
        const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1 + r, c })];
        if (cell && fmt && cell.t === "n") cell.z = fmt;
      });
    });
    sheet["!cols"] = section.columns.map((c) => ({
      wch: Math.min(60, Math.max(c.header.length, ...section.rows.map((r) => formatReportCell(r[c.key] ?? null, c.kind).length)) + 2),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName(section.title, used));
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function renderPdf(def: ReportDefinition): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(def.title, margin, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (def.subtitle) doc.text(def.subtitle, margin, 25);

  let y = 32;
  const pageHeight = doc.internal.pageSize.getHeight();
  for (const section of def.sections) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(section.title, margin, y);
    autoTable(doc, {
      startY: y + 3,
      head: [section.columns.map((c) => c.header)],
      body: section.rows.map((row) => section.columns.map((c) => formatReportCell(row[c.key] ?? null, c.kind))),
      theme: "grid",
      margin: { left: margin, right: margin },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 9, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(
        section.columns.map((c, i) => [i, { halign: c.kind && c.kind !== "text" ? ("right" as const) : ("left" as const) }]),
      ),
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;
    if (section.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(section.note, doc.internal.pageSize.getWidth() - 2 * margin);
      doc.text(lines, margin, y);
      y += lines.length * 4;
    }
    y += 6;
  }
  return Buffer.from(doc.output("arraybuffer"));
}

export function renderReport(def: ReportDefinition, format: ReportFormat): Buffer {
  return format === "pdf" ? renderPdf(def) : renderXlsx(def);
}
