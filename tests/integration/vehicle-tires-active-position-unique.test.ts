import type { PoolClient } from "@neondatabase/serverless";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../server/db";
import { reportVehicleTireActivePositionGaps, VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL } from "../../server/init-database";
import { tires } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Index unique partiel uq_vehicle_tires_active_position : un seul pneu actif par position.
 * Posé seulement sans doublon, jamais en corrigeant ; les doublons sont journalisés (couples véhicule,
 * position) pour que l'atelier démonte le pneu en trop. Les montages et le DDL se font dans une
 * transaction annulée ; le véhicule et le pneu de test sont retirés en fin de suite.
 */

const INDEX = "uq_vehicle_tires_active_position";
const ids = createIdBag();
let vehicleId = 0;
let tireId = 0;

async function hasIndex(q: Pick<PoolClient, "query">) {
  const { rows } = await q.query("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1", [INDEX]);
  return rows.length === 1;
}

/** Transaction annulée, index retiré ; `mounted(position, status)` insère un montage sur le véhicule de test. */
async function withoutIndex(run: (client: PoolClient, mounted: (position: string, status?: string) => Promise<number>) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP INDEX IF EXISTS ${INDEX}`);
    const mounted = async (position: string, status = "active") =>
      (await client.query(
        `INSERT INTO vehicle_tires (vehicle_id, tire_id, position, installation_date, installation_mileage, status)
         VALUES ($1, $2, $3, '2026-11-07', 1000, $4) RETURNING id`,
        [vehicleId, tireId, position, status],
      )).rows[0].id as number;
    await run(client, mounted);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

beforeAll(async () => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const [tire] = await db
    .insert(tires)
    .values({ brand: "TEST-MARQUE", model: uniqueTestToken("tire"), size: "315/80R22.5", stockQuantity: 0, minStockLevel: 0 } as typeof tires.$inferInsert)
    .returning();
  tireId = tire.id;
}, 60000);

afterAll(async () => {
  if (tireId) await db.delete(tires).where(inArray(tires.id, [tireId]));
  await cleanupCreated(ids);
});

describe("un pneu actif par position en base", { timeout: 120_000 }, () => {
  it("l'index est posé au démarrage et le relevé ne signale rien", async () => {
    expect(await hasIndex(pool)).toBe(true);
    const log = { warn: vi.fn() };
    expect(await reportVehicleTireActivePositionGaps(pool, log)).toEqual({ missing: false, duplicates: [] });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("second démarrage : aucune écriture (pas d'identifiant de transaction attribué)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL);
      await reportVehicleTireActivePositionGaps(client, { warn: vi.fn() });
      const { rows } = await client.query("SELECT pg_current_xact_id_if_assigned()::text AS xid");
      expect(rows[0].xid).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("doublons existants : index non posé, aucun montage modifié, couples journalisés, démarrage poursuivi", async () => {
    await withoutIndex(async (client, mounted) => {
      const a = await mounted("front_left");
      const b = await mounted("front_left");
      await mounted("front_right", "removed");
      await mounted("front_right");

      await expect(client.query(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL)).resolves.toBeDefined();
      expect(await hasIndex(client)).toBe(false);
      const { rows } = await client.query(
        "SELECT id, status FROM vehicle_tires WHERE vehicle_id = $1 AND position = 'front_left' ORDER BY id",
        [vehicleId],
      );
      expect(rows).toEqual([{ id: a, status: "active" }, { id: b, status: "active" }]);

      const log = { warn: vi.fn() };
      const report = await reportVehicleTireActivePositionGaps(client, log);
      expect(report.missing).toBe(true);
      expect(report.duplicates).toContainEqual({ vehicleId, position: "front_left", vehicleTireIds: [a, b] });
      expect(report.duplicates.some((d) => d.vehicleId === vehicleId && d.position === "front_right")).toBe(false);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0][0]).toMatchObject({ duplicateCount: report.duplicates.length });
      expect(log.warn.mock.calls[0][1]).toMatch(/L'atelier démonte le pneu en trop/);
    });
  });

  it("doublon réglé par l'atelier : index posé au passage suivant, puis aucune écriture", async () => {
    await withoutIndex(async (client, mounted) => {
      await mounted("rear_left_outer");
      const b = await mounted("rear_left_outer");
      await client.query(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL);
      expect(await hasIndex(client)).toBe(false);

      await client.query("UPDATE vehicle_tires SET status = 'removed' WHERE id = $1", [b]);
      await client.query(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL);
      expect(await hasIndex(client)).toBe(true);

      const indexOid = "SELECT indexrelid FROM pg_index WHERE indexrelid = $1::regclass";
      const { rows: before } = await client.query(indexOid, [INDEX]);
      await client.query(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL);
      const { rows: after } = await client.query(indexOid, [INDEX]);
      expect(after).toEqual(before);

      await client.query("SAVEPOINT second_active");
      await expect(mounted("rear_left_outer")).rejects.toMatchObject({ code: "23505", constraint: INDEX });
      await client.query("ROLLBACK TO SAVEPOINT second_active");
      // L'historique (montages démontés) reste libre à la même position.
      await expect(mounted("rear_left_outer", "removed")).resolves.toBeGreaterThan(0);
    });
  });
});
