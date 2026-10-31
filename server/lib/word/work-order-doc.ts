import { Document, Paragraph, TextRun, type Table } from "docx";
import { buildHeaderParagraphs, sectionProperties } from "./header";
import { formatDate, formatNumber, heading, para, signatureTable, table, txt } from "./common";
import type { DocHeaderConfig, WorkOrderDocData } from "./types";

export function vehicleLabel(v: WorkOrderDocData["vehicle"]): string {
  const model = [v.brand, v.model].filter((s) => s && s.trim()).join(" ");
  return [v.registration, model].filter((s) => s && s.trim()).join(" - ") || "-";
}

/** Ordre de travail : identite, vehicule, travaux, pieces, signatures. */
export function buildWorkOrderDocument(data: WorkOrderDocData, header?: DocHeaderConfig): Document {
  const children: (Paragraph | Table)[] = [
    ...buildHeaderParagraphs(header),
    new Paragraph({ children: [new TextRun({ text: `Ordre de travail n° ${data.id}`, bold: true, size: 32 })] }),
    para(txt(data.title), { bold: true }),
    heading("Informations"),
    table(
      ["Champ", "Valeur"],
      [
        ["Statut", txt(data.statusLabel)],
        ["Priorité", txt(data.priorityLabel)],
        ["Véhicule", vehicleLabel(data.vehicle)],
        ["Technicien", txt(data.technicianName)],
        ["Début", formatDate(data.startDate)],
        ["Fin", formatDate(data.endDate)],
      ],
    ),
    heading("Description"),
    para(txt(data.description, "Aucune description.")),
    heading("Diagnostic"),
    para(txt(data.diagnosis, "Aucun diagnostic.")),
    heading("Travaux"),
  ];

  if (data.lines.length === 0) children.push(para("Aucune ligne de travail."));
  else
    children.push(
      table(
        ["Travail", "Technicien", "Heures prévues", "Heures réelles", "Statut"],
        data.lines.map((l) => [
          txt(l.label),
          txt(l.technicianName),
          formatNumber(l.estimatedHours),
          formatNumber(l.actualHours),
          txt(l.status),
        ]),
      ),
    );

  children.push(heading("Pièces"));
  if (data.parts.length === 0) children.push(para("Aucune pièce."));
  else
    children.push(
      table(
        ["Référence", "Désignation", "Quantité"],
        data.parts.map((p) => [txt(p.reference), txt(p.name), String(p.quantity)]),
      ),
    );

  children.push(heading("Signatures"), signatureTable(["Technicien", "Chef d'atelier", "Client / Réception"]));
  children.push(
    para(`Édité le ${formatDate(data.generatedAt)}${data.generatedByName ? ` par ${data.generatedByName}` : ""}`),
  );

  return new Document({ creator: "FleetMaster", title: `Ordre de travail ${data.id}`, sections: [{ ...sectionProperties(header), children }] });
}
