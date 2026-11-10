import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { VEHICLE_POSITIONS_GPS_SQL } from "../../server/init-database";
import { purgeVehiclePositions } from "../../server/lib/gps-retention";
import { uniqueTestToken } from "../support/ids";

/**
 * GPS V1 en base (server/db/migrations/20261110_vehicle_positions_gps.sql) : invariants de vehicle_positions et
 * des points A/B de missions, rejeu sans doublon, purge par durée, cascade, idempotence du SQL de démarrage.
 * Tout se joue dans des transactions annulées : aucune ligne ne reste en base.
 */

const CONSTRAINTS = [
  "vehicle_positions_source_check",
  "vehicle_positions_phone_check",
  "vehicle_positions_tracker_check",
  "vehicle_positions_coords_check",
  "vehicle_positions_measures_check",
  "vehicle_positions_client_point_unique",
  "vehicle_positions_vehicle_id_vehicles_id_fk",
  "vehicle_positions_mission_id_missions_id_fk",
  "vehicle_positions_driver_id_drivers_id_fk",
  "vehicle_positions_submitted_by_users_id_fk",
  "missions_pickup_geo_check",
  "missions_delivery_geo_check",
];

async function inRolledBackTx(fn: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Erreur Postgres (code, contrainte) d'une requête jouée sous point de sauvegarde. */
async function pgError(client: PoolClient, text: string, params: unknown[] = []) {
  await client.query("SAVEPOINT s");
  try {
    await client.query(text, params);
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT s");
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
  await client.query("RELEASE SAVEPOINT s");
  return null;
}

async function constraintStates(client: PoolClient) {
  const { rows } = await client.query(
    "SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname",
    [CONSTRAINTS],
  );
  return rows as Array<{ conname: string; convalidated: boolean }>;
}

/** Utilisateur, véhicule et mission de test créés dans la transaction en cours. */
async function fixtures(client: PoolClient) {
  const token = uniqueTestToken("gps");
  const user = await client.query(
    "INSERT INTO users (username, email, name, password, role) VALUES ($1, $2, $1, 'x', 'driver') RETURNING id",
    [token, `${token}@fleet.test`],
  );
  const vehicle = await client.query(
    "INSERT INTO vehicles (registration_number, brand, model, year) VALUES ($1, 'Renault', 'T480', 2021) RETURNING id",
    [token.slice(0, 32)],
  );
  const mission = await client.query(
    "INSERT INTO missions (order_number, pickup_address, delivery_address) VALUES ($1, 'Douala', 'Yaoundé') RETURNING id",
    [token],
  );
  return { userId: user.rows[0].id as number, vehicleId: vehicle.rows[0].id as number, missionId: mission.rows[0].id as number };
}

const INSERT_PHONE_POINT = `INSERT INTO vehicle_positions
  (vehicle_id, mission_id, source, submitted_by, client_point_id, recorded_at, lat, lng, accuracy_m, speed_kmh, heading)
  VALUES ($1, $2, 'phone', $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT ON CONSTRAINT vehicle_positions_client_point_unique DO NOTHING`;

describe("GPS V1 en base", { timeout: 120_000 }, () => {
  it("au démarrage : les douze contraintes sont posées et validées, la fonction de purge existe", async () => {
    await inRolledBackTx(async (client) => {
      const states = await constraintStates(client);
      expect(states.map((s) => s.conname).sort()).toEqual([...CONSTRAINTS].sort());
      expect(states.every((s) => s.convalidated)).toBe(true);
      const { rows } = await client.query("SELECT to_regprocedure('purge_vehicle_positions(integer)') IS NOT NULL AS ok");
      expect(rows[0].ok).toBe(true);
    });
  });

  it("second démarrage : aucune écriture, catalogue compris (pas d'identifiant de transaction attribué)", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(VEHICLE_POSITIONS_GPS_SQL);
      await client.query(VEHICLE_POSITIONS_GPS_SQL);
      const { rows } = await client.query("SELECT pg_current_xact_id_if_assigned()::text AS xid");
      expect(rows[0].xid).toBeNull();
    });
  });

  it("base sans aucun objet GPS : tout est créé, missions existantes intactes", async () => {
    await inRolledBackTx(async (client) => {
      const { missionId } = await fixtures(client);
      await client.query("DROP FUNCTION purge_vehicle_positions(integer)");
      await client.query("DROP TABLE vehicle_positions");
      await client.query(`ALTER TABLE missions DROP COLUMN pickup_lat, DROP COLUMN pickup_lng, DROP COLUMN pickup_hub_code,
        DROP COLUMN delivery_lat, DROP COLUMN delivery_lng, DROP COLUMN delivery_hub_code`);
      expect(await constraintStates(client)).toEqual([]);

      await client.query(VEHICLE_POSITIONS_GPS_SQL);
      const states = await constraintStates(client);
      expect(states.map((s) => s.conname).sort()).toEqual([...CONSTRAINTS].sort());
      expect(states.every((s) => s.convalidated)).toBe(true);
      const { rows } = await client.query(
        "SELECT pickup_lat, delivery_hub_code, pickup_address FROM missions WHERE id = $1",
        [missionId],
      );
      expect(rows).toEqual([{ pickup_lat: null, delivery_hub_code: null, pickup_address: "Douala" }]);
    });
  });

  it("missions verrouillée à l'ajout des colonnes A/B : contraintes missions sautées, démarrage poursuivi, posées au suivant", async () => {
    await inRolledBackTx(async (client) => {
      await client.query(`ALTER TABLE missions DROP COLUMN pickup_lat, DROP COLUMN pickup_lng, DROP COLUMN pickup_hub_code,
        DROP COLUMN delivery_lat, DROP COLUMN delivery_lng, DROP COLUMN delivery_hub_code`);
      // Verrou indisponible simulé : tout ALTER TABLE visant missions lève lock_not_available (55P03).
      await client.query(`CREATE FUNCTION gps_test_missions_locked() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE objid = 'missions'::regclass) THEN
            RAISE EXCEPTION 'missions verrouillée (simulation)' USING ERRCODE = 'lock_not_available';
          END IF;
        END $$`);
      await client.query(`CREATE EVENT TRIGGER gps_test_missions_locked ON ddl_command_end
        WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION gps_test_missions_locked()`);

      await expect(client.query(VEHICLE_POSITIONS_GPS_SQL)).resolves.toBeDefined();
      const names = (await constraintStates(client)).map((s) => s.conname);
      expect(names).not.toContain("missions_pickup_geo_check");
      expect(names).not.toContain("missions_delivery_geo_check");
      expect(names).toContain("vehicle_positions_phone_check");

      await client.query("DROP EVENT TRIGGER gps_test_missions_locked");
      await client.query(VEHICLE_POSITIONS_GPS_SQL);
      const states = await constraintStates(client);
      expect(states.map((s) => s.conname).sort()).toEqual([...CONSTRAINTS].sort());
      expect(states.every((s) => s.convalidated)).toBe(true);
    });
  });

  it("missions déjà hors règle : contrainte posée NOT VALID, aucune ligne modifiée, démarrage poursuivi", async () => {
    await inRolledBackTx(async (client) => {
      const { missionId } = await fixtures(client);
      await client.query("ALTER TABLE missions DROP CONSTRAINT missions_pickup_geo_check");
      await client.query("UPDATE missions SET pickup_lat = 4.05 WHERE id = $1", [missionId]);

      await expect(client.query(VEHICLE_POSITIONS_GPS_SQL)).resolves.toBeDefined();
      const state = (await constraintStates(client)).find((s) => s.conname === "missions_pickup_geo_check");
      expect(state).toEqual({ conname: "missions_pickup_geo_check", convalidated: false });
      const { rows } = await client.query("SELECT pickup_lat, pickup_lng FROM missions WHERE id = $1", [missionId]);
      expect(rows).toEqual([{ pickup_lat: 4.05, pickup_lng: null }]);
    });
  });

  it("point téléphone accepté ; rejeu du même identifiant sans doublon", async () => {
    await inRolledBackTx(async (client) => {
      const { userId, vehicleId, missionId } = await fixtures(client);
      const pointId = "6f1c1f3e-0b2a-4e59-9a57-5d2f4c7b8a10";
      const args = [vehicleId, missionId, userId, pointId, "2026-11-10T08:00:00Z", 4.0511, 9.7679, 12, 54, 359.5];
      expect((await client.query(INSERT_PHONE_POINT, args)).rowCount).toBe(1);
      expect((await client.query(INSERT_PHONE_POINT, args)).rowCount).toBe(0);
      const { rows } = await client.query(
        "SELECT count(*)::int AS n, bool_and(NOT suspect) AS clean, bool_and(received_at IS NOT NULL) AS received FROM vehicle_positions WHERE mission_id = $1",
        [missionId],
      );
      expect(rows[0]).toEqual({ n: 1, clean: true, received: true });
    });
  });

  it("points refusés par la base, contrainte nommée (23514)", async () => {
    await inRolledBackTx(async (client) => {
      const { userId, vehicleId, missionId } = await fixtures(client);
      const point = (over: Partial<Record<"lat" | "lng" | "accuracy" | "speed" | "heading", number>>) => [
        vehicleId, missionId, userId, crypto.randomUUID(), "2026-11-10T08:00:00Z",
        over.lat ?? 4, over.lng ?? 9, over.accuracy ?? 10, over.speed ?? 0, over.heading ?? 0,
      ];
      const check = (constraint: string) => ({ code: "23514", constraint });
      expect(await pgError(client, INSERT_PHONE_POINT, point({ lat: 90.5 }))).toEqual(check("vehicle_positions_coords_check"));
      expect(await pgError(client, INSERT_PHONE_POINT, point({ lng: -181 }))).toEqual(check("vehicle_positions_coords_check"));
      expect(await pgError(client, INSERT_PHONE_POINT, point({ heading: 360 }))).toEqual(check("vehicle_positions_measures_check"));
      expect(await pgError(client, INSERT_PHONE_POINT, point({ accuracy: -1 }))).toEqual(check("vehicle_positions_measures_check"));
      expect(await pgError(client, INSERT_PHONE_POINT, point({ speed: -3 }))).toEqual(check("vehicle_positions_measures_check"));
      expect(
        await pgError(client, "INSERT INTO vehicle_positions (vehicle_id, source, submitted_by, client_point_id, recorded_at, lat, lng) VALUES ($1, 'phone', $2, gen_random_uuid(), now(), 4, 9)", [vehicleId, userId]),
      ).toEqual(check("vehicle_positions_phone_check"));
      expect(
        await pgError(client, "INSERT INTO vehicle_positions (vehicle_id, source, recorded_at, lat, lng) VALUES ($1, 'tracker', now(), 4, 9)", [vehicleId]),
      ).toEqual(check("vehicle_positions_tracker_check"));
      expect(
        await pgError(client, "INSERT INTO vehicle_positions (vehicle_id, source, device_id, recorded_at, lat, lng) VALUES ($1, 'satellite', 1, now(), 4, 9)", [vehicleId]),
      ).toEqual(check("vehicle_positions_source_check"));
      // Balise : ni mission ni utilisateur requis.
      expect(
        await pgError(client, "INSERT INTO vehicle_positions (vehicle_id, source, device_id, recorded_at, lat, lng) VALUES ($1, 'tracker', 42, now(), 4, 9)", [vehicleId]),
      ).toBeNull();
    });
  });

  it("missions : points A/B acceptés en paire bornée, refusés incomplets ou hub sans coordonnées", async () => {
    await inRolledBackTx(async (client) => {
      const { missionId } = await fixtures(client);
      const set = (sql: string) => pgError(client, `UPDATE missions SET ${sql} WHERE id = $1`, [missionId]);
      expect(await set("pickup_lat = 4.05, pickup_lng = 9.70, pickup_hub_code = 'DLA-PORT'")).toBeNull();
      expect(await set("delivery_lat = 3.87, delivery_lng = 11.52")).toBeNull();
      expect(await set("delivery_lng = NULL")).toEqual({ code: "23514", constraint: "missions_delivery_geo_check" });
      expect(await set("pickup_lat = 91")).toEqual({ code: "23514", constraint: "missions_pickup_geo_check" });
      expect(await set("pickup_hub_code = ''")).toEqual({ code: "23514", constraint: "missions_pickup_geo_check" });
      expect(await set("pickup_lat = NULL, pickup_lng = NULL")).toEqual({ code: "23514", constraint: "missions_pickup_geo_check" });
      expect(await set("pickup_lat = NULL, pickup_lng = NULL, pickup_hub_code = NULL")).toBeNull();
    });
  });

  it("purge : points périmés supprimés, récents gardés ; durée invalide refusée (22023)", async () => {
    await inRolledBackTx(async (client) => {
      const { userId, vehicleId, missionId } = await fixtures(client);
      const at = (days: number) => [vehicleId, missionId, userId, crypto.randomUUID(), new Date(Date.now() - days * 86_400_000).toISOString(), 4, 9, null, null, null];
      await client.query(INSERT_PHONE_POINT, at(31));
      await client.query(INSERT_PHONE_POINT, at(45));
      await client.query(INSERT_PHONE_POINT, at(29));
      await client.query(INSERT_PHONE_POINT, at(0));

      expect(await purgeVehiclePositions(client, 30)).toBeGreaterThanOrEqual(2);
      const { rows } = await client.query("SELECT count(*)::int AS n FROM vehicle_positions WHERE mission_id = $1", [missionId]);
      expect(rows[0].n).toBe(2);
      expect(await purgeVehiclePositions(client, 30)).toBe(0);

      expect(await pgError(client, "SELECT purge_vehicle_positions(0)")).toEqual({ code: "22023", constraint: undefined });
      expect(await pgError(client, "SELECT purge_vehicle_positions(NULL)")).toEqual({ code: "22023", constraint: undefined });
    });
  });

  it("purge sans point périmé : 0 et aucune écriture", async () => {
    await inRolledBackTx(async (client) => {
      expect(await purgeVehiclePositions(client, 30)).toBe(0);
      const { rows } = await client.query("SELECT pg_current_xact_id_if_assigned()::text AS xid");
      expect(rows[0].xid).toBeNull();
    });
  });

  it("suppression de la mission : ses points suivent (cascade)", async () => {
    await inRolledBackTx(async (client) => {
      const { userId, vehicleId, missionId } = await fixtures(client);
      await client.query(INSERT_PHONE_POINT, [vehicleId, missionId, userId, crypto.randomUUID(), "2026-11-10T08:00:00Z", 4, 9, null, null, null]);
      await client.query("DELETE FROM missions WHERE id = $1", [missionId]);
      const { rows } = await client.query("SELECT count(*)::int AS n FROM vehicle_positions WHERE vehicle_id = $1", [vehicleId]);
      expect(rows[0].n).toBe(0);
    });
  });
});
