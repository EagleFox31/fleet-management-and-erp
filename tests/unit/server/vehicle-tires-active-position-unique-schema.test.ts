import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { vehicleTires } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261107_vehicle_tires_active_position_unique.sql";
const INDEX = "uq_vehicle_tires_active_position";

function fromMigration(): string {
  return norm(
    norm(readFileSync(MIGRATION, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));

function fromInitDatabase(): string {
  const src = initSource();
  const marker = "export const VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("un pneu actif par position : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage puis relit l'écart", () => {
    expect(initSource()).toMatch(
      /await pool\.query\(VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL\);\s*await reportVehicleTireActivePositionGaps\(pool\);/,
    );
  });

  it("index unique partiel sur les montages actifs, posé seulement sans doublon, sans rien corriger", () => {
    const sql = fromMigration();
    expect(sql).toContain(`CREATE UNIQUE INDEX ${INDEX} ON vehicle_tires (vehicle_id, position) WHERE status = 'active';`);
    expect(sql).toContain("WHERE status = 'active' GROUP BY vehicle_id, position HAVING count(*) > 1");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available OR unique_violation THEN");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("le schéma Drizzle déclare le même index partiel", () => {
    const index = getTableConfig(vehicleTires).indexes.find((i) => i.config.name === INDEX);
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.columns.map((c) => (c as { name: string }).name)).toEqual(["vehicle_id", "position"]);
    expect(index!.config.where).toBeDefined();
  });
});
