import { listenerPool, pool } from "../server/db";

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const result = await pool.query(sql);
  return result.rows as T[];
}

async function main() {
  const timestamps = await q<{ table_name: string; column_name: string; data_type: string }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND data_type LIKE 'timestamp%'
    ORDER BY data_type, table_name, column_name
  `);

  const checks = await q<{ table: string; conname: string; def: string }>(`
    SELECT conrelid::regclass::text AS table, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype='c' AND connamespace = 'public'::regnamespace
  `);

  const fkNoIndex = await q<{ tbl: string; col: string }>(`
    SELECT conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=cols.attnum
    WHERE c.contype='f' AND c.connamespace='public'::regnamespace
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid=c.conrelid AND a.attnum = ANY(i.indkey)
    )
    ORDER BY 1, 2
  `);

  const statusCols = await q(`
    SELECT table_name, column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema='public'
      AND column_name IN ('status','role','urgency','vehicle_type','fuel_type')
    ORDER BY 1, 2
  `);

  const prCols = await q(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='part_requirements'
    ORDER BY ordinal_position
  `);

  const keyTables = await q(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('parts','tires','users','work_orders','vehicles')
    ORDER BY table_name, ordinal_position
  `);

  const roles = await q(`SELECT role, count(*)::int AS n FROM users WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`);
  const prStatus = await q(`SELECT status, count(*)::int AS n FROM part_requirements GROUP BY 1 ORDER BY 2 DESC`);
  const woStatus = await q(`SELECT status, count(*)::int AS n FROM work_orders GROUP BY 1 ORDER BY 2 DESC`);
  const views = await q(`SELECT table_name FROM information_schema.views WHERE table_schema='public'`);

  const uniques = await q(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema='public'
      AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY')
      AND tc.table_name IN ('parts','vehicles','users','tires','part_requirements','fuel_records')
    ORDER BY 1, 2
  `);

  const orphans = {
    partsCreatedBy: await q(`
      SELECT count(*)::int AS n FROM parts
      WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM users)
    `),
    partsNullCreatedBy: await q(`SELECT count(*)::int AS n FROM parts WHERE created_by IS NULL`),
    tiresNullCreatedBy: await q(`SELECT count(*)::int AS n FROM tires WHERE created_by IS NULL`),
    prWithoutPart: await q(`SELECT count(*)::int AS n FROM part_requirements WHERE part_id IS NULL`),
  };

  const emptyTables = await q<{ table_name: string; n: number }>(`
    SELECT relname AS table_name, n_live_tup::int AS n
    FROM pg_stat_user_tables
    WHERE schemaname='public' AND n_live_tup = 0
    ORDER BY 1
  `);

  console.log(JSON.stringify({
    timestampWithoutTz: timestamps.filter((r) => r.data_type === "timestamp without time zone").length,
    timestampWithTz: timestamps.filter((r) => r.data_type === "timestamp with time zone").length,
    checkCount: checks.length,
    checks,
    fkWithoutIndexCount: fkNoIndex.length,
    fkWithoutIndex: fkNoIndex,
    statusCols,
    prCols,
    keyTables,
    roles,
    prStatus,
    woStatus,
    views,
    uniques,
    orphans,
    emptyTables,
  }, null, 2));

  await Promise.allSettled([pool.end(), listenerPool.end()]);
}

main().catch(async (error) => {
  console.error(error);
  await Promise.allSettled([pool.end(), listenerPool.end()]);
  process.exit(1);
});
