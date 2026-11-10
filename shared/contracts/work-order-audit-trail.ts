/**
 * Historique d'un ordre de travail (P-13) : vue du journal d'audit filtrée
 * sur `entityType = 'work_order'`, du plus ancien au plus récent.
 * Drapeau `work-order-audit-trail`.
 */
import { z } from "zod";
import { auditLogRowSchema } from "./audit-logs";
import { routeIdSchema } from "./common";

export const workOrderAuditTrailPath = (id: number) => `/api/work-orders/${id}/audit-trail`;
export const workOrderAuditTrailParamsSchema = z.object({ id: routeIdSchema });

export const workOrderAuditTrailResponseSchema = z.array(auditLogRowSchema);

export type WorkOrderAuditTrailResponse = z.infer<typeof workOrderAuditTrailResponseSchema>;
