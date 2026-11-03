import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { initializeDatabase } from "../../server/init-database";

/**
 * FUEL3 : vehicles.tank_capacity_l et sa contrainte vehicles_tank_capacity_l_positive.
 * Les écritures de test se font dans une transaction annulée, ou sur une sentinelle supprimée
 * en fin de test : aucune ligne ne reste en base.
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

/**
 * Version de chaque ligne de vehicles hors données d'autres tests : `xmin` change à toute
 * écriture, même un `UPDATE … SET x = x`. Les lignes `TEST%` des autres fichiers, écrites en
 * parallèle, sont écartées, sauf la sentinelle de ce fichier. Le compteur global
 * `pg_stat_user_tables` comptait ces écritures concurrentes, en différé : échec aléatoire.
 */
async function vehicleVersions(sentinel: string) {
  const { rows } = await pool.query(
    `SELECT id, xmin::text AS version, md5(v::text) AS content
       FROM vehicles v
      WHERE registration_number NOT LIKE 'TEST%' OR registration_number = $1
      ORDER BY id`,
    [sentinel],
  );
  return rows;
}

describe("FUEL3 : capacité des réservoirs en base", { timeout: 120_000 }, () => {
  it("crée la colonne nullable, sans défaut, et la contrainte", async () => {
    await initializeDatabase();
    const rows = await catalog();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "real", attnotnull: false, default_expr: null });
    expect(rows[0].constraints).toHaveLength(1);
  });

  // Autonome : ne suppose pas qu'un seed (RCT-) a déjà tourné. Un véhicule inséré sans
  // la colonne, comme ceux d'avant FUEL3, reste à NULL.
  it("les véhicules existants restent à NULL (capacité inconnue, règle muette)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: inserted } = await client.query(
        `INSERT INTO vehicles (registration_number, brand, model, year)
         VALUES ($1, 'TEST', 'FUEL3', 2020) RETURNING tank_capacity_l`,
        [`TEST-FUEL3-NULL-${Date.now()}`],
      );
      expect(inserted[0].tank_capacity_l).toBeNull();

      const { rows } = await client.query(
        `SELECT count(tank_capacity_l)::int AS renseignes
           FROM vehicles WHERE registration_number NOT LIKE 'TEST%'`,
      );
      expect(rows[0].renseignes).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
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
    const sentinel = `TEST-FUEL3-SENTINEL-${Date.now()}`;
    await initializeDatabase();
    await pool.query(
      `INSERT INTO vehicles (registration_number, brand, model, year) VALUES ($1, 'TEST', 'FUEL3', 2020)`,
      [sentinel],
    );
    try {
      const catalogBefore = await catalog();
      const versionsBefore = await vehicleVersions(sentinel);
      expect(versionsBefore.length).toBeGreaterThan(0);
      await initializeDatabase();
      expect(await catalog()).toEqual(catalogBefore);
      expect(await vehicleVersions(sentinel)).toEqual(versionsBefore);
    } finally {
      await pool.query(`DELETE FROM vehicles WHERE registration_number = $1`, [sentinel]);
    }
  });
});
