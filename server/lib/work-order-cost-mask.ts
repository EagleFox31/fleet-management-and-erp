import type { NextFunction, Request, Response } from "express";
import { canReadWorkOrderCost } from "@shared/constants/roles";
import { moduleLogger } from "./logger";
/**
 * Masquage des coûts d'OT dans les lectures `GET /api/work-orders/*`.
 *
 * Les coûts sont réservés à `WORK_ORDER_COST_READ_ROLES`. Les routes qui servent ces lectures
 * restent ouvertes au chauffeur et au client (cloison par véhicule), qui reçoivent donc la
 * réponse sans les champs de coût, pas un refus. Liste fermée : toute autre clé est conservée.
 */
export const WORK_ORDER_COST_KEYS: readonly string[] = ["cost", "unitPrice", "totalCost", "estimatedCost", "partUnitPrice"];

const log = moduleLogger("work-order-cost-mask");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Copie de `value` sans les clés de coût, à toute profondeur (objets et tableaux ; Date et autres instances intactes). */
export function maskWorkOrderCost<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => maskWorkOrderCost(item)) as unknown as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (WORK_ORDER_COST_KEYS.includes(key)) continue;
    out[key] = maskWorkOrderCost(entry);
  }
  return out as T;
}

/**
 * Middleware monté sur `/api/work-orders` avant les routeurs : sur les GET, enveloppe `res.json`
 * (seules les réponses JSON passent par là : PDF et bons de sortie ne sont pas touchés). Le rôle
 * est lu à l'envoi, après la garde de la route (`req.user`, ou relecture du compte quand la garde
 * est `authenticate` seul) ; sans session, la garde a déjà répondu 401.
 */
export function workOrderCostMask(req: Request, res: Response, next: NextFunction): void {
  // HEAD : Express passe par la même route, `Content-Length` doit refléter le corps masqué.
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (req.user) return json(canReadWorkOrderCost(req.user.role) ? body : maskWorkOrderCost(body));
    const sessionUserId = req.session?.userId;
    // Sans session, la garde a normalement répondu 401 ; si une réponse JSON part quand même, elle est masquée.
    if (typeof sessionUserId !== "number") return json(maskWorkOrderCost(body));
    // Garde `authenticate` seule (GET /api/work-orders) : elle ne charge pas `req.user`, le rôle est relu.
    // Compte introuvable ou erreur de lecture : on masque (refus par défaut).
    import("../services/session-user")
      .then(({ findActiveSessionUser }) => findActiveSessionUser(sessionUserId))
      .then((user) => (user && canReadWorkOrderCost(user.role) ? body : maskWorkOrderCost(body)))
      .catch((err) => {
        log.error({ err, requestId: req.requestId }, "Relecture du rôle pour le masquage des coûts d'OT");
        return maskWorkOrderCost(body);
      })
      .then((out) => json(out))
      .catch(next);
    return res;
  }) as typeof res.json;
  next();
}
