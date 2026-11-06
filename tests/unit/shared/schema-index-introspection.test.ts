import { describe, expect, it } from "vitest";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../../shared/schema";

/*
 * drizzle-kit 0.30 relit un index en base en indexant le tableau de ses expressions par la position de la
 * colonne dans l'index (introspection `pg_get_expr(indexprs)` découpé en text[]) :
 * - une colonne simple placée avant une expression décale la lecture → expression null → ZodError ;
 * - `is_expression` vaut pour tout l'index : une colonne simple mêlée à une expression (même après elle) est
 *   relue comme expression, ne correspond jamais au schéma, et chaque push DROP puis recrée l'index (fenêtre
 *   sans unicité). Dans un index à expression, une colonne s'écrit donc sql`${table.col}` ;
 * - une virgule, un guillemet ou une accolade dans une expression casse le découpage '{…}'::text[].
 * Le premier `push` (base neuve) passe, les suivants plantent ou réécrivent l'index.
 * Incident du 2026-11-03 sur ux_part_specifications_part_name (part_id, lower(specification_name)).
 */
const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => value instanceof PgTable);

const offenders = tables.flatMap((table) => {
  const { name, indexes } = getTableConfig(table);
  return indexes.flatMap((index) => {
    const columns = index.config.columns;
    const kinds = columns.map((column) => (column instanceof SQL ? "expr" : "col"));
    const problems: string[] = [];
    if (kinds.includes("expr") && kinds.includes("col")) {
      problems.push("colonne simple mêlée à une expression (écrire sql`${table.col}`)");
    }
    const sqlText = columns
      .filter((column): column is SQL => column instanceof SQL)
      .map((column) => column.queryChunks.map((chunk) => (typeof chunk === "object" && chunk && "value" in chunk ? String((chunk as { value: unknown }).value) : "")).join(""));
    if (sqlText.some((text) => /[,"{}]/.test(text))) problems.push("virgule, guillemet ou accolade dans une expression");
    return problems.map((problem) => `${name}.${index.config.name ?? "(sans nom)"} : ${problem}`);
  });
});

describe("Schéma Drizzle : index relisibles par drizzle-kit push", () => {
  it("parcourt bien les tables du schéma", () => {
    expect(tables.length).toBeGreaterThan(50);
  });

  it("aucun index ne mêle colonne simple et expression, ni ne découpe mal une expression", () => {
    expect(offenders).toEqual([]);
  });
});
