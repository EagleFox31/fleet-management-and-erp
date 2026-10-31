import { Document, Paragraph, TextRun, type Table } from "docx";
import { buildHeaderParagraphs, sectionProperties } from "./header";
import { formatDate, heading, para, signatureTable, table, txt } from "./common";
import { vehicleLabel } from "./work-order-doc";
import type { DocHeaderConfig, WorkOrderDocData } from "./types";

/** Bon de sortie : les pieces qui quittent le magasin pour l'OT. */
export function buildExitVoucherDocument(data: WorkOrderDocData, header?: DocHeaderConfig): Document {
  const children: (Paragraph | Table)[] = [
    ...buildHeaderParagraphs(header),
    new Paragraph({ children: [new TextRun({ text: `Bon de sortie - OT n° ${data.id}`, bold: true, size: 32 })] }),
    para(txt(data.title), { bold: true }),
    table(
      ["Champ", "Valeur"],
      [
        ["Véhicule", vehicleLabel(data.vehicle)],
        ["Technicien", txt(data.technicianName)],
        ["Date", formatDate(data.generatedAt)],
      ],
    ),
    heading("Pièces sorties du stock"),
  ];

  if (data.parts.length === 0) children.push(para("Aucune pièce à sortir."));
  else
    children.push(
      table(
        ["Référence", "Désignation", "Quantité"],
        data.parts.map((p) => [txt(p.reference), txt(p.name), String(p.quantity)]),
      ),
    );

  children.push(heading("Signatures"), signatureTable(["Magasinier", "Technicien (réception)"]));
  return new Document({ creator: "FleetMaster", title: `Bon de sortie OT ${data.id}`, sections: [{ ...sectionProperties(header), children }] });
}
