import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { vehicles } from "../../../shared/schema";

/**
 * Dans un `select` Drizzle sur une seule table (sans jointure), les colonnes de la liste SELECT
 * sont écrites sans préfixe de table. Une sous-requête corrélée placée dans cette liste,
 * `sql\`(SELECT … FROM tire_rotations WHERE vehicle_id = ${vehicles.id})\``, devient
 * `vehicle_id = "id"` : Postgres résout `"id"` sur la table de la sous-requête, pas sur la table
 * externe. La requête s'exécute sans erreur et rend une valeur fausse (alertes de rotation des
 * pneus toujours vides jusqu'au 2026-11-08, `docs/analysis/LESSONS_LEARNED.md`).
 *
 * Forme sûre : alias explicites en SQL brut (`FROM vehicles v … WHERE vehicle_id = v.id`), ou une
 * jointure, qui fait qualifier les colonnes.
 */
const FROZEN: Record<string, string> = {};

const root = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function selectArgument(source: string, start: number): string | null {
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

/** Sous-requêtes corrélées sur une colonne Drizzle, dans la liste d'un select sans jointure. */
export function unqualifiedCorrelatedSubqueries(source: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const start = source.indexOf(".select(", from);
    if (start < 0) break;
    from = start + 1;
    const argument = selectArgument(source, start);
    if (argument === null) continue;
    const end = source.indexOf(";", start);
    const statement = source.slice(start, end < 0 ? undefined : end);
    if (/Join\(/.test(statement)) continue;
    const correlated = argument.match(/sql(<[^>]*>)?`[^`]*\(\s*select\b[^`]*\$\{\s*\w+\.\w+\s*\}[^`]*`/gi) ?? [];
    count += correlated.length;
  }
  return count;
}

function current(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const path of serverSources(join(root, "server"))) {
    const n = unqualifiedCorrelatedSubqueries(readFileSync(path, "utf8"));
    const rel = relative(root, path).split(sep).join("/");
    for (let i = 1; i <= n; i++) found[`${rel}#${i}`] = "";
  }
  return found;
}

describe("sous-requêtes corrélées dans un select Drizzle sans jointure", () => {
  it("Drizzle écrit la colonne externe sans préfixe : la sous-requête la capte (comportement figé)", () => {
    const { sql: text } = new QueryBuilder()
      .select({
        id: vehicles.id,
        next: sql`(SELECT next_rotation_mileage FROM tire_rotations WHERE vehicle_id = ${vehicles.id} LIMIT 1)`,
      })
      .from(vehicles)
      .toSQL();
    expect(text).toContain('vehicle_id = "id"');
  });

  it("détecte la forme à risque, pas la jointure ni le SQL brut aliasé", () => {
    const risky = 'db.select({ id: vehicles.id, n: sql`(SELECT x FROM r WHERE vehicle_id = ${vehicles.id})` }).from(vehicles);';
    expect(unqualifiedCorrelatedSubqueries(risky)).toBe(1);
    expect(unqualifiedCorrelatedSubqueries(risky.replace("sql`", "sql<number>`"))).toBe(1);
    const joined = 'db.select({ n: sql`(SELECT name FROM users WHERE id = ${w.createdBy})` }).from(w).leftJoin(users, eq(a, b));';
    expect(unqualifiedCorrelatedSubqueries(joined)).toBe(0);
    expect(unqualifiedCorrelatedSubqueries("db.execute(sql`SELECT (SELECT x FROM r WHERE vehicle_id = v.id) FROM vehicles v`);")).toBe(0);
    expect(unqualifiedCorrelatedSubqueries("db.select({ id: vehicles.id }).from(vehicles).where(sql`exists (select 1 from d where d.v = ${vehicles.id})`);")).toBe(0);
  });

  it("aucune occurrence dans server/ hors liste gelée (vide)", () => {
    const found = Object.keys(current()).sort();
    expect(found, "Sous-requête corrélée dans un select sans jointure : écrire la requête en SQL brut avec alias").toEqual(Object.keys(FROZEN).sort());
  });
});
