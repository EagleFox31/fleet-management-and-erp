import { Packer } from "docx";
import type { WorkOrderExportDoc } from "@shared/contracts/work-order-export";
import { buildExitVoucherDocument } from "./exit-voucher-doc";
import { buildWorkOrderDocument } from "./work-order-doc";
import { moduleLogger } from "../logger";
import { readTayHeaderImage } from "../tay-header-asset";
import { TAY_HEADER } from "./header";
import type { DocHeaderConfig, WorkOrderDocData } from "./types";

export type { WorkOrderDocData, WorkOrderDocLine, WorkOrderDocPart, DocHeaderConfig } from "./types";

const log = moduleLogger("word-export");

/** Complete l'en-tete avec le papier officiel (une seule resolution de chemin, partagee avec le PDF). */
async function withLogo(header: DocHeaderConfig = TAY_HEADER): Promise<DocHeaderConfig> {
  if (header.logo !== undefined) return header;
  const logo = await readTayHeaderImage();
  if (!logo) log.warn({ files: "attached_assets/TAY-header-final.png|TAY-header.png" }, "papier a en-tete TAY introuvable, repli texte");
  return { ...header, logo };
}

/** Genere le .docx demande ("ot" ou "bon-sortie"). Module pur : aucun acces base. */
export async function buildWorkOrderDocx(
  doc: WorkOrderExportDoc,
  data: WorkOrderDocData,
  header?: DocHeaderConfig,
): Promise<Buffer> {
  const resolved = await withLogo(header);
  const document = doc === "bon-sortie" ? buildExitVoucherDocument(data, resolved) : buildWorkOrderDocument(data, resolved);
  return Packer.toBuffer(document);
}

export function workOrderDocFilename(doc: WorkOrderExportDoc, id: number): string {
  return `${doc === "bon-sortie" ? "bon-sortie" : "ordre-travail"}-${id}.docx`;
}
