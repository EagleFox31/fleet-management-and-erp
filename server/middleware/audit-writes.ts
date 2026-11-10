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

/**
 * Chemin tel qu'Express le route : decode, sans casse, sans prefixe `/api` (lui aussi insensible a la casse :
 * `/API/work-orders` s'execute et doit etre journalise), sans barre finale.
 */
function normalizeAuditPath(path: string): string {
  const rawPath = path.split("?")[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Encodage invalide : Express repond 400, on garde le chemin brut.
  }
  return decoded.toLowerCase().replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "");
}

function findAuditRule(config: AuditConfig, method: string, path: string) {
  const action = ACTION_BY_METHOD[method.toUpperCase()];
  if (!action) return null;
  const clean = normalizeAuditPath(path);
  for (const rule of config.rules) {
    const m = rule.pattern.exec(clean);
    if (m) return { action, rule, match: m };
  }
  return null;
}

export function matchAuditRule(config: AuditConfig, method: string, path: string) {
  const found = findAuditRule(config, method, path);
  if (!found) return null;
  return { action: found.action, entityType: found.rule.entityType, entityId: found.match[found.rule.idGroup ?? 1] ?? null };
}

/** Creation dont l'id n'est connu que dans la reponse (`idFromResponse`). */
export function wantsResponseId(config: AuditConfig, method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && findAuditRule(config, method, path)?.rule.idFromResponse === true;
}

/** Journalise, apres la reponse (< 400), les ecritures dont le chemin correspond a une regle. */
export function auditWrites(config: AuditConfig): RequestHandler {
  return (req, res, next) => {
    const hit = matchAuditRule(config, req.method, req.originalUrl);
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
