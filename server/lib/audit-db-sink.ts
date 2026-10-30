import { db } from "../db";
import { activityLogs } from "@shared/schema";
import type { AuditEntry, AuditSink } from "./audit";

/** Ecrit une entree dans activity_logs. Id numerique -> entity_id, sinon entity_ref. */
export const dbAuditSink: AuditSink = async (e: AuditEntry) => {
  const numeric = e.entityId !== null && /^\d+$/.test(e.entityId);
  await db.insert(activityLogs).values({
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: numeric ? Number(e.entityId) : null,
    entityRef: e.entityId !== null && !numeric ? e.entityId : null,
    method: e.method,
    path: e.path,
    details: e.details ? { ...e.details, ...(e.requestId ? { requestId: e.requestId } : {}) } : e.requestId ? { requestId: e.requestId } : null,
    ipAddress: e.ipAddress ?? null,
    userAgent: e.userAgent ?? null,
  });
};
