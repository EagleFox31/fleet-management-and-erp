import { HeightRule, HeadingLevel, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

/** Texte sur, jamais "undefined" ni "null". */
export const txt = (v: unknown, fallback = "-"): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
};

export function formatDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

export const heading = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });

export const para = (text: string, opts: { bold?: boolean } = {}) =>
  new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] });

const cell = (text: string, bold = false) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

export function table(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

export function signatureTable(labels: string[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: labels.map((l) => cell(l, true)) }),
      new TableRow({
        height: { value: 1200, rule: HeightRule.ATLEAST },
        children: labels.map(() => cell("")),
      }),
    ],
  });
}
