import { describe, expect, it } from "vitest";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../../shared/schema";

/*
 * drizzle-kit 0.30 relit un index en base en indexant le tableau de ses expressions par la position de la
 * colonne dans l'index (introspection `pg_get_expr(indexprs)` découpé en text[]) :
 * - une colonne simple placée avant une expression décale la lecture → expression null → ZodError ;
 * - une virgule dans une expression la coupe en deux éléments.
 * Le premier `push` (base neuve) passe, le second (base existante : Neon, dev) plante.
 * Incident du 2026-11-03 sur ux_part_specifications_part_name (part_id, lower(specification_name)).
 */
const tables = Object.values(schema).filter((value): value is PgTable => value instanceof PgTable);

const offenders = tables.flatMap((table) => {
  const { name, indexes } = getTableConfig(table);
  return indexes.flatMap((index) => {
    const columns = index.config.columns;
    const kinds = columns.map((column) => (column instanceof SQL ? "expr" : "col"));
    const firstColumn = kinds.indexOf("col");
    const problems: string[] = [];
    if (firstColumn !== -1 && kinds.slice(firstColumn).includes("expr")) {
      problems.push("colonne simple avant une expression");
    }
    const sqlText = columns
      .filter((column): column is SQL => column instanceof SQL)
      .map((column) => column.queryChunks.map((chunk) => (typeof chunk === "object" && chunk && "value" in chunk ? String((chunk as { value: unknown }).value) : "")).join(""));
    if (sqlText.some((text) => text.includes(","))) problems.push("virgule dans une expression");
    return problems.map((problem) => `${name}.${index.config.name ?? "(sans nom)"} : ${problem}`);
  });
});

describe("Schéma Drizzle : index relisibles par drizzle-kit push", () => {
  it("parcourt bien les tables du schéma", () => {
    expect(tables.length).toBeGreaterThan(50);
  });

  it("aucun index ne place une colonne simple avant une expression, ni de virgule dans une expression", () => {
    expect(offenders).toEqual([]);
  });
});
