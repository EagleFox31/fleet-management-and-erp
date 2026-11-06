/**
 * Détecteur commun des tests d'hygiène de lecture d'une table Drizzle (vehicle-select-hygiene,
 * parts-select-hygiene) : repère les requêtes qui ramènent une ligne entière, donc toutes ses
 * colonnes sensibles, sans projection explicite.
 */

/** Argument équilibré du `.select(` qui précède la position donnée, ou null s'il n'y en a pas. */
export function selectArgument(source: string, position: number): string | null {
  const start = source.lastIndexOf(".select(", position);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + ".select".length; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(start + ".select(".length, i);
    }
  }
  return null;
}

/** `select()` vide, `{ alias: table }` ou `getTableColumns(table)` : la ligne entière est lue. */
export function isWholeRow(argument: string, table: string): boolean {
  return (
    argument.trim() === "" ||
    new RegExp(`:\\s*${table}\\s*[,}\\n]`).test(argument) ||
    new RegExp(`getTableColumns\\(\\s*${table}\\s*\\)`).test(argument)
  );
}

/** Lectures entières de `table` (from ou jointure), numérotées `${key}#n` dans l'ordre du fichier. */
export function findWholeTableReads(source: string, key: string, table: string): string[] {
  const found: string[] = [];
  const fromTable = new RegExp(`\\.(?:from|leftJoin|innerJoin|rightJoin)\\(\\s*${table}\\b(?!\\w)`, "g");
  let ordinal = 0;
  for (let match = fromTable.exec(source); match; match = fromTable.exec(source)) {
    const argument = selectArgument(source, match.index);
    if (argument !== null && isWholeRow(argument, table)) found.push(`${key}#${++ordinal}`);
  }
  return found;
}
