import { canReadWorkOrderCost } from "@shared/constants/roles";
import { roleJsonMask } from "./role-json-mask";
/**
 * Masquage des coûts d'OT dans les lectures `GET /api/work-orders/*`.
 *
 * Les coûts sont réservés à `WORK_ORDER_COST_READ_ROLES`. Les routes qui servent ces lectures
 * restent ouvertes au chauffeur et au client (cloison par véhicule), qui reçoivent donc la
 * réponse sans les champs de coût, pas un refus. Liste fermée : toute autre clé est conservée.
 */
export const WORK_ORDER_COST_KEYS: readonly string[] = ["cost", "unitPrice", "totalCost", "estimatedCost", "partUnitPrice"];

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
 * Middleware monté sur `/api/work-orders` avant les routeurs : masque les GET pour les rôles hors
 * WORK_ORDER_COST_READ_ROLES (mécanique commune : `role-json-mask.ts`).
 */
export const workOrderCostMask = roleJsonMask(
  (role, body) => (canReadWorkOrderCost(role) ? body : maskWorkOrderCost(body)),
  "coûts d'OT",
);
