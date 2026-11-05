import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { vehicleDeletionEffects, vehicles, insertVehicleSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261105_vehicle_lifecycle.sql";

function fromMigration(): string {
  return norm(
    norm(readFileSync(MIGRATION, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const VEHICLE_LIFECYCLE_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("cycle de vie véhicule : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage", () => {
    expect(readFileSync("server/init-database.ts", "utf8")).toContain("await pool.query(VEHICLE_LIFECYCLE_SQL);");
  });

  it("chaque DDL est borné par lock_timeout et rend la main en WARNING", () => {
    const sql = fromMigration();
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    const blocks = sql.split("DO $$").slice(1);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block).toMatch(/EXCEPTION WHEN lock_not_available THEN\s+RAISE WARNING/);
  });

  it("le SQL crée ce que shared/schema.ts déclare", () => {
    const sql = fromMigration();
    for (const column of getTableConfig(vehicleDeletionEffects).columns) expect(sql).toContain(`    ${column.name} `);
    expect(sql).toContain("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;");
    expect(getTableConfig(vehicles).columns.map((c) => c.name)).toContain("deleted_by");
  });

  it("le client ne peut pas écrire l'auteur de la suppression", () => {
    expect(Object.keys(insertVehicleSchema.shape)).not.toContain("deletedBy");
  });
});
