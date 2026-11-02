import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";

/**
 * FUEL3 : vehicles.tank_capacity_l et sa contrainte vehicles_tank_capacity_l_positive.
 * Les écritures de test se font dans une transaction annulée : aucune ligne ne reste en base.
 */

async function catalog() {
  const { rows } = await pool.query(
    `SELECT a.attnum, a.atttypid::regtype::text AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr,
            (SELECT array_agg(c.oid::text || ':' || pg_get_constraintdef(c.oid))
               FROM pg_constraint c
              WHERE c.conrelid = 'vehicles'::regclass AND c.conname = 'vehicles_tank_capacity_l_positive') AS constraints
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'vehicles'::regclass AND a.attname = 'tank_capacity_l' AND NOT a.attisdropped`,
  );
  return rows;
}

async function vehicleCounters() {
  await pool.query("SELECT pg_stat_force_next_flush()").catch(() => undefined);
  const { rows } = await pool.query(
    `SELECT n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = 'vehicles'`,
  );
  return rows[0];
}

describe("FUEL3 : capacité des réservoirs en base", { timeout: 120_000 }, () => {
  it("crée la colonne nullable, sans défaut, et la contrainte", async () => {
    await initializeDatabase();
    const rows = await catalog();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "real", attnotnull: false, default_expr: null });
    expect(rows[0].constraints).toHaveLength(1);
  });

  it("les véhicules existants restent à NULL (capacité inconnue, règle muette)", async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total, count(tank_capacity_l)::int AS renseignes
         FROM vehicles WHERE registration_number NOT LIKE 'TEST%'`,
    );
    expect(rows[0].total).toBeGreaterThan(0);
    expect(rows[0].renseignes).toBe(0);
  });

  it("accepte une capacité positive ou NULL, refuse 0, négatif, NaN et Infinity", async () => {
    const client = await pool.connect();
    const refused: Array<{ value: string; code?: string; constraint?: string }> = [];
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO vehicles (registration_number, brand, model, year, tank_capacity_l)
         VALUES ($1, 'TEST', 'FUEL3', 2020, 400) RETURNING id, tank_capacity_l`,
        [`TEST-FUEL3-${Date.now()}`],
      );
      const id = rows[0].id;
      expect(rows[0].tank_capacity_l).toBe(400);

      await client.query(`UPDATE vehicles SET tank_capacity_l = 0.5 WHERE id = $1`, [id]);
      await client.query(`UPDATE vehicles SET tank_capacity_l = NULL WHERE id = $1`, [id]);

      for (const value of ["0", "-10", "NaN", "Infinity"]) {
        await client.query("SAVEPOINT essai");
        try {
          await client.query(`UPDATE vehicles SET tank_capacity_l = $2::real WHERE id = $1`, [id, value]);
          refused.push({ value, code: "accepté" });
        } catch (error) {
          const pgError = error as { code?: string; constraint?: string };
          refused.push({ value, code: pgError.code, constraint: pgError.constraint });
        }
        await client.query("ROLLBACK TO SAVEPOINT essai");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    for (const entry of refused) {
      expect(entry).toMatchObject({ code: "23514", constraint: "vehicles_tank_capacity_l_positive" });
    }
    expect(refused.map((entry) => entry.value)).toEqual(["0", "-10", "NaN", "Infinity"]);
  });

  it("un second démarrage ne change ni le catalogue ni les lignes de vehicles", async () => {
    await initializeDatabase();
    const catalogBefore = await catalog();
    const countersBefore = await vehicleCounters();
    await initializeDatabase();
    expect(await catalog()).toEqual(catalogBefore);
    expect(await vehicleCounters()).toEqual(countersBefore);
  });
});
