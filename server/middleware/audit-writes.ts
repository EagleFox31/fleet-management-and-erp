import type { RequestHandler } from "express";
import type { AuditAction } from "@shared/contracts/audit-logs";
import { prepareAuditBody, recordAudit } from "../lib/audit";

export interface AuditRule {
  /** Motif sur le chemin sans prefixe /api, ex. /work-orders/:id */
  pattern: RegExp;
  entityType: string;
  /** Index du groupe de capture portant l'id (defaut 1). */
  idGroup?: number;
}
export interface AuditConfig {
  rules: AuditRule[];
}

const ACTION_BY_METHOD: Record<string, AuditAction> = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

export function matchAuditRule(config: AuditConfig, method: string, path: string) {
  const action = ACTION_BY_METHOD[method.toUpperCase()];
  if (!action) return null;
  const clean = path.split("?")[0].replace(/\/+$/, "");
  for (const rule of config.rules) {
    const m = rule.pattern.exec(clean);
    if (m) return { action, entityType: rule.entityType, entityId: m[rule.idGroup ?? 1] ?? null };
  }
  return null;
}

/** Journalise, apres la reponse (< 400), les ecritures dont le chemin correspond a une regle. */
export function auditWrites(config: AuditConfig): RequestHandler {
  return (req, res, next) => {
    const hit = matchAuditRule(config, req.method, req.originalUrl.replace(/^\/api/, ""));
    if (!hit) return next();
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      void recordAudit({
        userId: (req as { user?: { id?: number } }).user?.id ?? null,
        action: hit.action,
        entityType: hit.entityType,
        entityId: hit.entityId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        requestId: (req as { requestId?: string }).requestId,
        ipAddress: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        details: prepareAuditBody(req.body),
      });
    });
    next();
  };
}
