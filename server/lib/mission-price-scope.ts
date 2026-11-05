import { TARIFF_GRID_READ_ROLES } from "@shared/constants/roles";

/**
 * Prix convenu d'une mission (O3) : lisible par ceux qui lisent la grille tarifaire
 * (`TARIFF_GRID_READ_ROLES`). Technicien, chauffeur et client ne le voient jamais, même quand
 * la route renvoie la ligne entière de `missions`.
 *
 * Forme unique, comme `vehicle-price-scope` : la clé reste présente et vaut `null`.
 * Un lecteur absent est traité comme non autorisé : échec fermé.
 */
export type MissionPriceReader = { role?: string | null } | null | undefined;

export function canReadMissionPrice(reader: MissionPriceReader): boolean {
  return (TARIFF_GRID_READ_ROLES as readonly string[]).includes(String(reader?.role ?? ""));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Une mission porte les deux colonnes ensemble ; l'une sans l'autre n'est pas une ligne de `missions`. */
function isMissionLike(value: Record<string, unknown>): boolean {
  return "agreedPrice" in value && "tariffGridId" in value;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = walk(child);
  if (isMissionLike(next)) {
    next.agreedPrice = null;
    next.tariffGridId = null;
  }
  return next;
}

/**
 * Tableaux et objets imbriqués (liste, `{ mission }`, affectation, trame temps réel) : toute ligne
 * qui porte `agreedPrice` et `tariffGridId` est expurgée, quelle que soit sa profondeur.
 * L'entrée n'est jamais modifiée ; dates et instances non simples restent intactes.
 */
export function redactMissionPrice<T>(reader: MissionPriceReader, value: T): T {
  if (canReadMissionPrice(reader)) return value;
  return walk(value) as T;
}
