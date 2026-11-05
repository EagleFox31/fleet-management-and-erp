import { PART_CATALOG_EVENT_ROLES } from "@shared/constants/roles";

/**
 * Prix d'achat des pneus : lu par le personnel hors chauffeur (même périmètre que le catalogue
 * des pièces). Le chauffeur garde la lecture de la fiche, sans le prix.
 */
export function canReadTirePrice(role: string | null | undefined): boolean {
  return (PART_CATALOG_EVENT_ROLES as readonly string[]).includes((role ?? "").trim().toLowerCase());
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const walk = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(walk);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key !== "purchasePrice") out[key] = walk(inner);
  }
  return out;
};

/** Liste, fiche ou objet imbriqué : retire `purchasePrice` à toute profondeur. L'entrée n'est jamais modifiée. */
export function redactTirePrice<T>(role: string | null | undefined, value: T): T {
  return canReadTirePrice(role) ? value : (walk(value) as T);
}
