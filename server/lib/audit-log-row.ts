import { AUDIT_ACTIONS, type AuditAction, type AuditLogRow } from "@shared/contracts/audit-logs";
import type { ActivityLog } from "@shared/schema";
import { maskSecrets } from "./audit";

function toAction(raw: string): AuditAction {
  const a = raw.toLowerCase();
  return (AUDIT_ACTIONS as readonly string[]).includes(a) ? (a as AuditAction) : "update";
}

/** Ligne du journal (`activity_logs` + nom d'utilisateur) vers la forme du contrat, secrets masqués. */
export function toAuditLogRow({ log, userName }: { log: ActivityLog; userName: string | null }): AuditLogRow {
  return {
    id: log.id,
    at: log.createdAt.toISOString(),
    userId: log.userId,
    userName: userName ?? null,
    action: toAction(log.action),
    entityType: log.entityType,
    entityId: log.entityId !== null ? String(log.entityId) : log.entityRef,
    method: log.method,
    path: log.path,
    details:
      log.details && typeof log.details === "object" && !Array.isArray(log.details)
        ? (maskSecrets(log.details) as Record<string, unknown>)
        : null,
  };
}
