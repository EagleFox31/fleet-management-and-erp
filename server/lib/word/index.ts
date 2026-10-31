import { Packer } from "docx";
import type { WorkOrderExportDoc } from "@shared/contracts/work-order-export";
import { buildExitVoucherDocument } from "./exit-voucher-doc";
import { buildWorkOrderDocument } from "./work-order-doc";
import type { DocHeaderConfig, WorkOrderDocData } from "./types";

export type { WorkOrderDocData, WorkOrderDocLine, WorkOrderDocPart, DocHeaderConfig } from "./types";

/** Genere le .docx demande ("ot" ou "bon-sortie"). Module pur : aucun acces base. */
export async function buildWorkOrderDocx(
  doc: WorkOrderExportDoc,
  data: WorkOrderDocData,
  header?: DocHeaderConfig,
): Promise<Buffer> {
  const document = doc === "bon-sortie" ? buildExitVoucherDocument(data, header) : buildWorkOrderDocument(data, header);
  return Packer.toBuffer(document);
}

export function workOrderDocFilename(doc: WorkOrderExportDoc, id: number): string {
  return `${doc === "bon-sortie" ? "bon-sortie" : "ordre-travail"}-${id}.docx`;
}
