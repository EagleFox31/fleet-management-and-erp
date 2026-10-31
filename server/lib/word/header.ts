import { AlignmentType, BorderStyle, Paragraph, TextRun } from "docx";
import type { DocHeaderConfig } from "./types";

/** En-tete TAY par defaut : texte seul (le logo reste a fournir). */
export const TAY_HEADER: DocHeaderConfig = {
  companyName: "TAY",
  tagline: "Gestion de flotte et maintenance",
};

export function buildHeaderParagraphs(config: DocHeaderConfig = TAY_HEADER): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: config.companyName, bold: true, size: 36 })],
    }),
  ];
  if (config.tagline) {
    out.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080", space: 4 } },
        spacing: { after: 240 },
        children: [new TextRun({ text: config.tagline, size: 20, color: "505050" })],
      }),
    );
  }
  return out;
}
