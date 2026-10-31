import { AlignmentType, BorderStyle, Header, ImageRun, Paragraph, TextRun, type ISectionOptions } from "docx";
import type { DocHeaderConfig } from "./types";

/** En-tete TAY par defaut : le papier officiel est charge a la generation, le texte sert de repli. */
export const TAY_HEADER: DocHeaderConfig = {
  companyName: "TAY",
  tagline: "Gestion de flotte et maintenance",
};

// A4, marges de 1417 twips (papier officiel TAY-Entetes.docx) : largeur utile 9072 twips = 605 px.
const PAGE_MARGIN = { left: 1417, right: 1417, bottom: 1417, header: 737 };
const CONTENT_WIDTH_PX = 605;
const TOP_MARGIN_WITH_LOGO = 2800;
const TOP_MARGIN_TEXT = 1417;

/** Dimensions PNG lues dans l'entete IHDR (octets 16 a 23). */
export function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Image a la largeur du papier, proportions conservees. null si le PNG est illisible. */
function logoRun(logo: Buffer): ImageRun | null {
  const size = pngSize(logo);
  if (!size || size.width === 0) return null;
  return new ImageRun({
    type: "png",
    data: logo,
    transformation: { width: CONTENT_WIDTH_PX, height: Math.round((CONTENT_WIDTH_PX * size.height) / size.width) },
  });
}

/** Vrai en-tete Word (word/header1.xml) quand le papier officiel est disponible. */
export function buildPageHeader(config: DocHeaderConfig = TAY_HEADER): Header | undefined {
  const run = config.logo ? logoRun(config.logo) : null;
  return run ? new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run] })] }) : undefined;
}

/** Proprietes de section : en-tete officiel et marges du papier. */
export function sectionProperties(config: DocHeaderConfig = TAY_HEADER): Pick<ISectionOptions, "headers" | "properties"> {
  const header = buildPageHeader(config);
  return {
    ...(header ? { headers: { default: header } } : {}),
    properties: { page: { margin: { ...PAGE_MARGIN, top: header ? TOP_MARGIN_WITH_LOGO : TOP_MARGIN_TEXT } } },
  };
}

/** Repli texte, dans le corps : uniquement sans image. */
export function buildHeaderParagraphs(config: DocHeaderConfig = TAY_HEADER): Paragraph[] {
  if (buildPageHeader(config)) return [];
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
