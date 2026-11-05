import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";

const TABLES = [
  "vehicle_document_types", "login_attempts_by_username", "notification_preferences", "backup_runs",
  "fuel_anomaly_resolutions", "fuel_prices", "incidents", "users", "alerts", "work_orders",
  "activity_logs", "part_requirements", "fuel_records",
];

/**
 * Instantané déterministe, table par table : nombre de lignes et empreinte des `xmin`.
 * Toute écriture validée (INSERT, UPDATE même à valeur égale, DELETE) change le `xmin` ou le nombre
 * de lignes, quelle que soit la connexion du pool qui l'a faite. Les compteurs `pg_stat_user_tables`
 * ne conviennent pas : `pg_stat_force_next_flush()` ne vide que les statistiques de la connexion
 * appelante, celles des autres connexions arrivent en différé et rendaient le test instable.
 * Limite voulue : une écriture annulée (ROLLBACK) ne laisse aucune version visible et n'est pas vue.
 * Tri par `xmin::text` puis `ctid` : l'empreinte ne dépend que des versions visibles, pas d'un
 * ordre de parcours que le planificateur peut changer.
 */
async function snapshot() {
  const parts: string[] = [];
  for (const table of TABLES) {
    const { rows } = await pool.query(
      `SELECT count(*)::text AS n, coalesce(md5(string_agg(xmin::text, ',' ORDER BY xmin::text, ctid)), '-') AS h
       FROM "${table}"`,
    );
    parts.push(`${table}:${rows[0].n}:${rows[0].h}`);
  }
  return parts;
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
    const before = await snapshot();
    await initializeDatabase();
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it("garde-fou : l'instantané détecte une écriture validée, même à valeur égale", async () => {
    await initializeDatabase();
    const before = await snapshot();
    const { rowCount } = await pool.query(
      `UPDATE vehicle_document_types SET label = label WHERE ctid = (SELECT ctid FROM vehicle_document_types LIMIT 1)`,
    );
    expect(rowCount).toBe(1);
    const after = await snapshot();
    expect(after).not.toEqual(before);
    expect(after.filter((p, i) => p !== before[i]).map((p) => p.split(":")[0])).toEqual(["vehicle_document_types"]);
  });
});
