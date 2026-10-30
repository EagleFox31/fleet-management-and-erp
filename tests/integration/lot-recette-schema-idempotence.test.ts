import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";

const TABLES = [
  "vehicle_document_types", "login_attempts_by_username", "notification_preferences", "backup_runs",
  "fuel_anomaly_resolutions", "fuel_prices", "incidents", "users", "alerts", "work_orders",
  "activity_logs", "part_requirements", "fuel_records",
];

async function counters() {
  await pool.query("SELECT pg_stat_force_next_flush()").catch(() => undefined);
  const { rows } = await pool.query(
    `SELECT relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = ANY($1) ORDER BY relname`,
    [TABLES],
  );
  return rows.map((r) => `${r.relname}:${r.n_tup_ins}/${r.n_tup_upd}/${r.n_tup_del}`);
}

describe("schéma du lot recette : idempotence", { timeout: 120_000 }, () => {
  it("crée les tables et colonnes attendues", async () => {
    await initializeDatabase();
    const { rows } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()
       AND ((table_name = 'work_orders' AND column_name LIKE 'qc\_%') OR (table_name = 'part_requirements' AND column_name = 'received_at')
         OR (table_name = 'fuel_records' AND column_name = 'validation_status') OR (table_name = 'users' AND column_name = 'locked_until'))`,
    );
    expect(rows.length).toBe(7);
    const price = await pool.query(`SELECT price_per_liter FROM fuel_prices WHERE effective_from = DATE '2000-01-01'`);
    expect(Number(price.rows[0].price_per_liter)).toBe(828);
    const types = await pool.query(`SELECT count(*)::int AS n FROM vehicle_document_types`);
    expect(types.rows[0].n).toBeGreaterThanOrEqual(9);
  });

  it("un second démarrage n'écrit aucune ligne", async () => {
    await initializeDatabase();
    const before = await counters();
    await initializeDatabase();
    const after = await counters();
    expect(after).toEqual(before);
  });
});
