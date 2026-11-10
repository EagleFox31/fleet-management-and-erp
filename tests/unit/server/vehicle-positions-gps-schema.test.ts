import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  GPS_POSITION_RETENTION_DEFAULT_DAYS,
  gpsPositionRetentionDays,
  purgeVehiclePositions,
} from "../../../server/lib/gps-retention";
import { insertMissionSchema, missions, vehiclePositions } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261110_vehicle_positions_gps.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const VEHICLE_POSITIONS_GPS_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

const MISSION_GEO_COLUMNS = ["pickup_lat", "pickup_lng", "pickup_hub_code", "delivery_lat", "delivery_lng", "delivery_hub_code"];

describe("GPS V1 : vehicle_positions, points A/B, purge — init-database, migration jumelle et Drizzle", () => {
  it("init-database porte exactement le SQL de la migration, appelé au démarrage", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
    expect(readFileSync("server/init-database.ts", "utf8")).toContain("await pool.query(VEHICLE_POSITIONS_GPS_SQL);");
  });

  it("verrou consultatif et lock_timeout en tête, création idempotente", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));\nSET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vehicle_positions \(/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS vehicle_positions_mission_recorded_idx/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS vehicle_positions_vehicle_recorded_idx/);
    // Pas de table de consentement (décision du 2026-11-10).
    expect(sql).not.toMatch(/location_consents/);
  });

  it("chaque colonne et chaque contrainte Drizzle de vehicle_positions existe dans le SQL, sous le même nom", () => {
    const sql = fromMigration();
    const config = getTableConfig(vehiclePositions);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\n  ${column.name} `));
    const names = [
      ...config.checks.map((c) => c.name),
      ...config.foreignKeys.map((fk) => fk.getName()),
      ...config.uniqueConstraints.map((u) => u.name),
    ];
    expect(names).toHaveLength(10);
    for (const name of names) expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
    expect(config.indexes.map((i) => i.config.name).sort()).toEqual([
      "vehicle_positions_mission_driver_idx",
      "vehicle_positions_mission_recorded_idx",
      "vehicle_positions_vehicle_recorded_idx",
    ]);
  });

  it("l'index (mission_id, driver_id) : init-database et migration jumelle identiques, idempotents", () => {
    const strip = (t: string) => norm(norm(t).split("\n").filter((l) => !l.startsWith("--")).join("\n"));
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    const marker = "export const VEHICLE_POSITIONS_MISSION_DRIVER_IDX_SQL = `";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const fromInit = norm(src.slice(start + marker.length, src.indexOf("`;", start)));
    const migration = strip(readFileSync("server/db/migrations/20261110_vehicle_positions_mission_driver_idx.sql", "utf8"));
    expect(fromInit).toBe(migration);
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS vehicle_positions_mission_driver_idx ON vehicle_positions \(mission_id, driver_id\)/);
    expect(src).toContain("await pool.query(VEHICLE_POSITIONS_MISSION_DRIVER_IDX_SQL);");
  });

  it("missions : les six colonnes A/B et leurs deux CHECK sont dans le SQL et dans Drizzle", () => {
    const sql = fromMigration();
    const config = getTableConfig(missions);
    const drizzleColumns = config.columns.map((c) => c.name);
    for (const col of MISSION_GEO_COLUMNS) {
      expect(drizzleColumns, col).toContain(col);
      expect(sql, col).toContain(`('${col}', `);
    }
    for (const name of ["missions_pickup_geo_check", "missions_delivery_geo_check"]) {
      expect(config.checks.map((c) => c.name)).toContain(name);
      expect(sql, name).toContain(`('missions', '${name}', 'CHECK (`);
    }
  });

  it("insertMissionSchema ferme les six colonnes A/B : un corps de requête ne peut pas les écrire", () => {
    const geoKeys = ["pickupLat", "pickupLng", "pickupHubCode", "deliveryLat", "deliveryLng", "deliveryHubCode"];
    const shape = Object.keys(insertMissionSchema.shape);
    for (const key of geoKeys) expect(shape, key).not.toContain(key);
    // Zod (objet non strict) retire les clés inconnues : rien n'atteint l'insertion.
    const parsed = insertMissionSchema.partial().parse({
      pickupLat: 3.86,
      pickupLng: 11.52,
      pickupHubCode: "YDE",
      deliveryLat: 4.05,
      deliveryLng: 9.7,
      deliveryHubCode: "DLA",
    });
    for (const key of geoKeys) expect(parsed, key).not.toHaveProperty(key);
  });

  it("la réconciliation au démarrage relit les douze contraintes", () => {
    const src = readFileSync("server/init-database.ts", "utf8");
    const config = getTableConfig(vehiclePositions);
    const names = [
      ...config.checks.map((c) => c.name),
      ...config.foreignKeys.map((fk) => fk.getName()),
      ...config.uniqueConstraints.map((u) => u.name),
      "missions_pickup_geo_check",
      "missions_delivery_geo_check",
    ];
    for (const name of names) expect(src, name).toContain(`  '${name}',`);
  });
});

describe("rétention GPS : durée en configuration", () => {
  it("absente ou invalide : 30 jours", () => {
    expect(GPS_POSITION_RETENTION_DEFAULT_DAYS).toBe(30);
    for (const raw of [undefined, "", "  ", "0", "-5", "1.5", "abc", "3651", "1e3"]) {
      expect(gpsPositionRetentionDays({ GPS_POSITION_RETENTION_DAYS: raw }), String(raw)).toBe(30);
    }
  });

  it("entier de 1 à 3650 : retenu tel quel", () => {
    expect(gpsPositionRetentionDays({ GPS_POSITION_RETENTION_DAYS: "1" })).toBe(1);
    expect(gpsPositionRetentionDays({ GPS_POSITION_RETENTION_DAYS: " 45 " })).toBe(45);
    expect(gpsPositionRetentionDays({ GPS_POSITION_RETENTION_DAYS: "3650" })).toBe(3650);
  });

  it("la purge appelle la fonction en base avec la durée et renvoie le nombre supprimé", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ deleted: 7 }] })) };
    expect(await purgeVehiclePositions(client, 12)).toBe(7);
    expect(client.query).toHaveBeenCalledWith("SELECT purge_vehicle_positions($1) AS deleted", [12]);
  });
});
