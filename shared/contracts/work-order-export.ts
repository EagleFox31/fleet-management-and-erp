/**
 * Documents Word d'un ordre de travail (P-07) : l'OT lui-même ou le bon de
 * sortie. La réponse est le fichier, pas du JSON.
 */
import { z } from "zod";
import { idSchema } from "./common";

export const WORK_ORDER_EXPORT_DOCS = ["ot", "bon-sortie"] as const;
export type WorkOrderExportDoc = (typeof WORK_ORDER_EXPORT_DOCS)[number];

export const workOrderExportPath = (id: number, doc: WorkOrderExportDoc) => `/api/work-orders/${id}/export?doc=${doc}`;

export const workOrderExportParamsSchema = z.object({ id: idSchema });
export const workOrderExportQuerySchema = z.object({ doc: z.enum(WORK_ORDER_EXPORT_DOCS) });

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type WorkOrderExportQuery = z.infer<typeof workOrderExportQuerySchema>;
