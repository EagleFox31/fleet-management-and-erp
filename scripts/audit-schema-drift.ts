/**
 * Compare shared/schema.ts (Drizzle) with the live Neon public schema.
 * Usage: node --env-file=.env --import tsx scripts/audit-schema-drift.ts
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { listenerPool, pool } from "../server/db";
import * as schema from "../shared/schema";

type DbColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

type Finding = {
  severity: "high" | "medium" | "low";
  kind: string;
  table: string;
  detail: string;
};

function isPgTable(value: unknown): value is Parameters<typeof getTableConfig>[0] {
  try {
    getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    return true;
  } catch {
    return false;
  }
}

function normalizeSqlType(raw: string): string {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (t === "serial" || t === "int" || t === "int4") return "integer";
  if (t.startsWith("numeric")) return "numeric";
  if (t === "timestamp" || t === "timestamp without time zone") {
    return "timestamp without time zone";
  }
  if (t === "timestamptz" || t === "timestamp with time zone") {
    return "timestamp with time zone";
  }
  if (t === "bool") return "boolean";
  if (t === "float4") return "real";
  if (t === "float8" || t === "double precision") return "double precision";
  if (t === "json") return "json";
  return t;
}

function drizzleColumns(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((col) => ({
      name: col.name,
      sqlType: normalizeSqlType(col.getSQLType()),
      notNull: col.notNull,
      hasDefault: col.hasDefault,
    })),
  };
}

async function main() {
  const drizzleTables = Object.values(schema)
    .filter(isPgTable)
    .map(drizzleColumns);

  const drizzleByName = new Map(drizzleTables.map((t) => [t.name, t]));

  const columnsRes = await pool.query<DbColumn>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           column_default, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const dbByTable = new Map<string, DbColumn[]>();
  for (const row of columnsRes.rows) {
    const list = dbByTable.get(row.table_name) ?? [];
    list.push(row);
    dbByTable.set(row.table_name, list);
  }

  const countsRes = await pool.query<{ table_name: string; n: string }>(`
    SELECT relname AS table_name, n_live_tup::text AS n
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
  `);
  const rowCounts = new Map(countsRes.rows.map((r) => [r.table_name, Number(r.n)]));

  const fkRes = await pool.query<{
    table_name: string;
    column_name: string;
    foreign_table: string;
    foreign_column: string;
  }>(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const findings: Finding[] = [];

  const drizzleNames = new Set(drizzleByName.keys());
  const dbNames = new Set(dbByTable.keys());

  for (const name of [...dbNames].sort()) {
    if (!drizzleNames.has(name)) {
      findings.push({
        severity: "medium",
        kind: "table_in_db_not_in_drizzle",
        table: name,
        detail: `Table présente en Neon, absente de shared/schema.ts (~${rowCounts.get(name) ?? "?"} lignes)`,
      });
    }
  }

  for (const name of [...drizzleNames].sort()) {
    if (!dbNames.has(name)) {
      findings.push({
        severity: "high",
        kind: "table_in_drizzle_not_in_db",
        table: name,
        detail: "Table déclarée dans Drizzle, absente de Neon",
      });
    }
  }

  for (const [name, drizzleTable] of drizzleByName) {
    const dbCols = dbByTable.get(name);
    if (!dbCols) continue;

    const dbColByName = new Map(dbCols.map((c) => [c.column_name, c]));
    const drizzleColNames = new Set(drizzleTable.columns.map((c) => c.name));

    for (const col of drizzleTable.columns) {
      const live = dbColByName.get(col.name);
      if (!live) {
        findings.push({
          severity: "high",
          kind: "column_missing_in_db",
          table: name,
          detail: `Colonne Drizzle \`${col.name}\` (${col.sqlType}${col.notNull ? ", NOT NULL" : ""}) absente de Neon`,
        });
        continue;
      }

      const liveType = normalizeSqlType(live.data_type);
      if (liveType !== col.sqlType) {
        const serialOk =
          col.sqlType === "integer" &&
          liveType === "integer" &&
          (live.column_default ?? "").includes("nextval");
        if (!serialOk) {
          findings.push({
            severity: "medium",
            kind: "type_mismatch",
            table: name,
            detail: `\`${col.name}\` Drizzle=${col.sqlType} Neon=${liveType} (${live.udt_name})`,
          });
        }
      }

      const liveNotNull = live.is_nullable === "NO";
      if (liveNotNull !== col.notNull) {
        findings.push({
          severity: liveNotNull && !col.notNull ? "low" : "high",
          kind: "nullability_mismatch",
          table: name,
          detail: `\`${col.name}\` Drizzle notNull=${col.notNull} Neon nullable=${live.is_nullable}`,
        });
      }
    }

    for (const live of dbCols) {
      if (!drizzleColNames.has(live.column_name)) {
        findings.push({
          severity: "medium",
          kind: "column_in_db_not_in_drizzle",
          table: name,
          detail: `Colonne Neon \`${live.column_name}\` (${live.data_type}) absente de Drizzle`,
        });
      }
    }
  }

  const sessionLike = [...dbNames].filter((n) =>
    /session|connect.pg|pg_stat/i.test(n) || n === "session",
  );

  const report = {
    drizzleTableCount: drizzleNames.size,
    neonTableCount: dbNames.size,
    findings,
    sessionTables: sessionLike,
    neonOnlyTables: [...dbNames].filter((n) => !drizzleNames.has(n)).sort(),
    drizzleOnlyTables: [...drizzleNames].filter((n) => !dbNames.has(n)).sort(),
    fkCount: fkRes.rows.length,
    rowCounts: Object.fromEntries(
      [...rowCounts.entries()].sort((a, b) => b[1] - a[1]),
    ),
  };

  console.log(JSON.stringify(report, null, 2));
  await Promise.allSettled([pool.end(), listenerPool.end()]);
}

main().catch(async (error) => {
  console.error(error);
  await Promise.allSettled([pool.end(), listenerPool.end()]);
  process.exit(1);
});
