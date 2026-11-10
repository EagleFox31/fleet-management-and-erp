import type { RequestHandler } from "express";
import type { AuditAction } from "@shared/contracts/audit-logs";
import { prepareAuditBody, recordAudit } from "../lib/audit";

export interface AuditRule {
  /** Motif sur le chemin sans prefixe /api, ex. /work-orders/:id */
  pattern: RegExp;
  entityType: string;
  /** Index du groupe de capture portant l'id (defaut 1). */
  idGroup?: number;
  /**
   * Creation sans id dans le chemin (`POST /work-orders`) : l'id est lu dans le corps JSON de la reponse.
   * Sans lui, l'entree serait journalisee avec `entityId = null` et absente de l'historique de l'entite.
   */
  idFromResponse?: boolean;
}
export interface AuditConfig {
  rules: AuditRule[];
}

const ACTION_BY_METHOD: Record<string, AuditAction> = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

export function matchAuditRule(config: AuditConfig, method: string, path: string) {
  const action = ACTION_BY_METHOD[method.toUpperCase()];
  if (!action) return null;
  // Express route sans casse et decode le chemin : comparer de meme, sinon `/PART-SALES` ou
  // `/work-orders/%35` s'executent sans journal.
  const rawPath = path.split("?")[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Encodage invalide : Express repond 400, on garde le chemin brut.
  }
  const clean = decoded.toLowerCase().replace(/\/+$/, "");
  for (const rule of config.rules) {
    const m = rule.pattern.exec(clean);
    if (m) return { action, entityType: rule.entityType, entityId: m[rule.idGroup ?? 1] ?? null };
  }
  return null;
}

function wantsResponseId(config: AuditConfig, method: string, originalUrl: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  const clean = originalUrl.replace(/^\/api/, "").split("?")[0].toLowerCase().replace(/\/+$/, "");
  return config.rules.find((r) => r.pattern.test(clean))?.idFromResponse === true;
}

/** Journalise, apres la reponse (< 400), les ecritures dont le chemin correspond a une regle. */
export function auditWrites(config: AuditConfig): RequestHandler {
  return (req, res, next) => {
    const hit = matchAuditRule(config, req.method, req.originalUrl.replace(/^\/api/, ""));
    if (!hit) return next();
    let responseId: string | null = null;
    if (hit.entityId === null && wantsResponseId(config, req.method, req.originalUrl)) {
      const json = res.json.bind(res);
      res.json = (body?: unknown) => {
        const id = (body as { id?: unknown } | null | undefined)?.id;
        if (typeof id === "number" && Number.isInteger(id) && id > 0) responseId = String(id);
        return json(body);
      };
    }
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      void recordAudit({
        userId: (req as { user?: { id?: number } }).user?.id ?? null,
        action: hit.action,
        entityType: hit.entityType,
        entityId: hit.entityId ?? responseId,
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
