import { STOCK_VALUATION_READ_ROLES } from "@shared/constants/roles";
import { roleJsonMask } from "./role-json-mask";

/**
 * Prix des pièces : lu par le personnel hors chauffeur (STOCK_VALUATION_READ_ROLES, même périmètre que
 * la valuation du stock et le prix des pneus). Le chauffeur garde la lecture du catalogue, sans prix.
 * Liste fermée : `unitPrice` (fiche, pièces posées), `additionalPrice` (variantes), `partUnitPrice` et
 * `estimatedCost` (quantité × prix) des demandes de pièce.
 */
export const PART_PRICE_KEYS: readonly string[] = ["unitPrice", "additionalPrice", "partUnitPrice", "estimatedCost"];

export function canReadPartPrice(role: string | null | undefined): boolean {
  return (STOCK_VALUATION_READ_ROLES as readonly string[]).includes((role ?? "").trim().toLowerCase());
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const walk = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(walk);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!PART_PRICE_KEYS.includes(key)) out[key] = walk(inner);
  }
  return out;
};

/** Liste, fiche ou objet imbriqué : retire les clés de prix à toute profondeur. L'entrée n'est jamais modifiée. */
export function redactPartPrice<T>(role: string | null | undefined, value: T): T {
  return canReadPartPrice(role) ? value : (walk(value) as T);
}

/** Monté sur `/api/parts` et `/api/part-requirements` avant tout routeur (routes.ts compris) : masque les prix des GET pour les rôles hors périmètre. */
export const partPriceMask = roleJsonMask((role, body) => redactPartPrice(role, body), "prix des pièces");
