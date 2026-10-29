import { getTableColumns, type Column, type Table } from "drizzle-orm";
import type { ApiFieldError } from "@shared/errors";

/**
 * Contrôle de type d'un corps de mise à jour, dérivé des colonnes Drizzle.
 *
 * Pour les routes historiques qui passent `req.body` au stockage sans schéma
 * Zod : une valeur que Postgres refuserait (« deux mille » dans une colonne
 * entière) revenait en 500, ou en 200 vide quand le stockage avalait l'erreur.
 *
 * Volontairement aussi tolérant que Postgres : une chaîne numérique est
 * acceptée pour une colonne numérique, une date ISO pour un horodatage. Seules
 * les colonnes connues de la table sont contrôlées ; les autres clés sont
 * laissées au code appelant.
 */
export function columnTypeErrors(table: Table, body: unknown): ApiFieldError[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const columns = getTableColumns(table) as Record<string, Column>;
  const errors: ApiFieldError[] = [];

  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    const column = columns[field];
    if (!column || value === undefined) continue;
    const message = invalidValueMessage(column, value);
    if (message) errors.push({ field, message });
  }
  return errors;
}

/**
 * Prépare un corps de mise à jour : une chaîne vide sur une colonne non texte
 * (nombre, date, booléen, énumération) signifie « champ vidé » et devient
 * `null` — Postgres refuse `""` pour une date. Renvoie le corps normalisé et
 * les erreurs de type à afficher.
 */
export function prepareColumnUpdate<T extends Record<string, unknown>>(
  table: Table,
  body: T,
): { data: T; errors: ApiFieldError[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { data: body, errors: [] };
  const columns = getTableColumns(table) as Record<string, Column>;
  const data: Record<string, unknown> = { ...body };
  for (const [field, value] of Object.entries(data)) {
    const column = columns[field];
    if (column && value === "" && !isTextColumn(column)) data[field] = null;
  }
  return { data: data as T, errors: columnTypeErrors(table, data) };
}

function isTextColumn(column: Column): boolean {
  return column.dataType === "string" && !(column.enumValues && column.enumValues.length > 0) &&
    !DECIMAL_TYPES.has(column.columnType) && !DATE_TYPES.has(column.columnType);
}

const INTEGER_TYPES = new Set(["PgInteger", "PgSerial", "PgSmallInt", "PgSmallSerial", "PgBigInt53", "PgBigSerial53"]);
const DECIMAL_TYPES = new Set(["PgNumeric", "PgReal", "PgDoublePrecision"]);
const DATE_TYPES = new Set(["PgTimestamp", "PgTimestampString", "PgDate", "PgDateString"]);

function invalidValueMessage(column: Column, value: unknown): string | null {
  if (value === null) return column.notNull ? "Ce champ est obligatoire." : null;
  const type = column.columnType;

  if (INTEGER_TYPES.has(type)) {
    return Number.isInteger(toNumber(value)) ? null : "Doit être un nombre entier.";
  }
  if (DECIMAL_TYPES.has(type)) {
    return Number.isFinite(toNumber(value)) ? null : "Doit être un nombre.";
  }
  if (DATE_TYPES.has(type)) {
    const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isNaN(time) ? "Doit être une date valide." : null;
  }
  if (type === "PgBoolean") {
    return typeof value === "boolean" ? null : "Doit valoir oui ou non.";
  }
  if (column.enumValues && column.enumValues.length > 0) {
    return column.enumValues.includes(value as string) ? null : "Valeur non autorisée.";
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}
