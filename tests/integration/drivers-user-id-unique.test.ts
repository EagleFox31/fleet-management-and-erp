import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import { DRIVERS_USER_ID_UNIQUE_SQL, reportDriverUserIdUniqueGaps } from "../../server/init-database";

/**
 * #113 : index unique partiel uq_drivers_user_id. Posé seulement sans doublon, jamais en supprimant ;
 * les doublons sont journalisés pour que la logistique choisisse la fiche gardée.
 * Toutes les écritures, DDL compris, se font dans une transaction annulée : rien ne reste en base.
 */

const INDEX = "uq_drivers_user_id";

async function hasIndex(q: Pick<PoolClient, "query">) {
  const { rows } = await q.query(
    "SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1",
    [INDEX],
  );
  return rows.length === 1;
}

/** Transaction annulée, index retiré, un compte TEST ; `driver(userId)` insère une fiche. */
async function withoutIndex(run: (client: PoolClient, userId: number, driver: (userId: number | null) => Promise<number>) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP INDEX IF EXISTS ${INDEX}`);
    const token = `test-113-${Date.now()}`;
    const { rows } = await client.query(
      `INSERT INTO users (username, password, email, name, role) VALUES ($1, 'x', $2, 'TEST 113', 'driver') RETURNING id`,
      [token, `${token}@fleet.test`],
    );
    const driver = async (userId: number | null) =>
      (await client.query(
        `INSERT INTO drivers (user_id, first_name, last_name) VALUES ($1, 'TEST', $2) RETURNING id`,
        [userId, token],
      )).rows[0].id as number;
    await run(client, rows[0].id, driver);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("#113 : une fiche chauffeur par compte en base", { timeout: 120_000 }, () => {
  it("l'index est posé au démarrage et le relevé ne signale rien", async () => {
    expect(await hasIndex(pool)).toBe(true);
    const log = { warn: vi.fn() };
    expect(await reportDriverUserIdUniqueGaps(pool, log)).toEqual({ missing: false, duplicates: [] });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("doublons existants : index non posé, aucune fiche supprimée, doublons journalisés", async () => {
    await withoutIndex(async (client, userId, driver) => {
      const a = await driver(userId);
      const b = await driver(userId);
      await driver(null);
      await driver(null);

      await client.query(DRIVERS_USER_ID_UNIQUE_SQL);
      expect(await hasIndex(client)).toBe(false);
      const { rows } = await client.query("SELECT id FROM drivers WHERE user_id = $1 ORDER BY id", [userId]);
      expect(rows.map((r) => r.id)).toEqual([a, b]);

      const log = { warn: vi.fn() };
      const report = await reportDriverUserIdUniqueGaps(client, log);
      expect(report.missing).toBe(true);
      expect(report.duplicates).toContainEqual({ userId, driverIds: [a, b] });
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][1]).toMatch(/logistique choisit la fiche gardée/);
    });
  });

  it("doublon réglé par le personnel : index posé au passage suivant, puis no-op", async () => {
    await withoutIndex(async (client, userId, driver) => {
      await driver(userId);
      const b = await driver(userId);
      await client.query(DRIVERS_USER_ID_UNIQUE_SQL);
      expect(await hasIndex(client)).toBe(false);

      await client.query("UPDATE drivers SET user_id = NULL WHERE id = $1", [b]);
      await client.query(DRIVERS_USER_ID_UNIQUE_SQL);
      expect(await hasIndex(client)).toBe(true);
      const { rows: before } = await client.query("SELECT indexrelid FROM pg_index WHERE indexrelid = $1::regclass", [INDEX]);
      await client.query(DRIVERS_USER_ID_UNIQUE_SQL);
      const { rows: after } = await client.query("SELECT indexrelid FROM pg_index WHERE indexrelid = $1::regclass", [INDEX]);
      expect(after).toEqual(before);

      await expect(driver(userId)).rejects.toMatchObject({ code: "23505" });
    });
  });
});
