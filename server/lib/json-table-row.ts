import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Lignes entières d'une table Drizzle agrégées en JSON dans une requête SQL unique
 * (`json_agg(jsonRowOf(table, "alias"))`), puis décodées comme un `db.select()` ordinaire.
 *
 * Le pilote transmet en texte les numeric, bigint, dates et horodatages : Drizzle les décode
 * depuis ce texte (`mapFromDriverValue`). En JSON, un numeric deviendrait un nombre et un
 * horodatage un format différent : ces colonnes sont donc castées en `::text`, et `rowFromJson`
 * applique le même décodeur. Le résultat est identique à celui d'un `select()` (preuve :
 * `tests/integration/tire-statistics-advanced-sql.test.ts`).
 */
const TEXT_ENCODED_TYPES = /^(numeric|decimal|bigint|timestamp|date|time|interval)/i;

/** `json_build_object` ne prend que 100 arguments, soit 50 colonnes. */
const MAX_COLUMNS = 50;

export function jsonRowOf(table: PgTable, alias: string): SQL {
  const columns = Object.entries(getTableColumns(table));
  if (columns.length > MAX_COLUMNS) {
    throw new Error(`jsonRowOf : ${columns.length} colonnes, au-delà de la limite de json_build_object (${MAX_COLUMNS})`);
  }
  const pairs = columns.map(([key, column]) => {
    if (!/^\w+$/.test(key)) throw new Error(`jsonRowOf : nom de propriété inattendu « ${key} »`);
    const ref = sql`${sql.identifier(alias)}.${sql.identifier(column.name)}`;
    const value = TEXT_ENCODED_TYPES.test(column.getSQLType()) ? sql`${ref}::text` : ref;
    return sql`${sql.raw(`'${key}'`)}, ${value}`;
  });
  return sql`json_build_object(${sql.join(pairs, sql`, `)})`;
}

/** Décode un objet produit par `jsonRowOf` comme le ferait `db.select().from(table)`. */
export function rowFromJson<T extends PgTable>(table: T, json: Record<string, unknown>): T["$inferSelect"] {
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value = json[key];
    row[key] = value === null || value === undefined ? null : column.mapFromDriverValue(value);
  }
  return row as T["$inferSelect"];
}
