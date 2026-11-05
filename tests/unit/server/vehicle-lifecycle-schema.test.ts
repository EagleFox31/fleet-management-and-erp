import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { insertMaintenanceScheduleSchema, maintenanceSchedules, vehicleDeletionEffects, vehicles, insertVehicleSchema } from "../../../shared/schema";
import { VEHICLE_DEACTIVATIONS } from "../../../server/services/vehicle-lifecycle-sources";

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
    expect(blocks).toHaveLength(5);
    for (const block of blocks) expect(block).toMatch(/EXCEPTION WHEN lock_not_available THEN\s+RAISE WARNING/);
  });

  it("le SQL crée ce que shared/schema.ts déclare", () => {
    const sql = fromMigration();
    // Colonnes du CREATE TABLE : recherche indentée, pour ne pas matcher un nom cité ailleurs.
    // applied_stamp est ajoutée après coup : recherche ciblée sur son ALTER.
    const added = { applied_stamp: "ALTER TABLE vehicle_deletion_effects ADD COLUMN IF NOT EXISTS applied_stamp timestamp;" };
    for (const { name } of getTableConfig(vehicleDeletionEffects).columns) {
      expect(sql).toContain(name in added ? added[name as keyof typeof added] : `    ${name} `);
    }
    expect(sql).toContain("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;");
    expect(getTableConfig(vehicles).columns.map((c) => c.name)).toContain("deleted_by");
  });

  it("maintenance_schedules.updated_at : lignes existantes non réécrites, déclencheur posé une fois", () => {
    const sql = fromMigration();
    // Ajout sans défaut puis SET DEFAULT : un ADD COLUMN ... DEFAULT now() daterait les lignes existantes.
    expect(sql).toContain("ALTER TABLE maintenance_schedules ADD COLUMN updated_at timestamp;");
    expect(sql).toContain("ALTER TABLE maintenance_schedules ALTER COLUMN updated_at SET DEFAULT now();");
    expect(sql).not.toMatch(/ADD COLUMN[^;]*updated_at[^;]*DEFAULT/);
    expect(sql).not.toMatch(/UPDATE\s+maintenance_schedules/i);
    // Base convergée : zéro écriture (ni ALTER, ni DROP/CREATE TRIGGER à chaque démarrage).
    expect(sql).not.toContain("DROP TRIGGER");
    expect(sql).toMatch(/IF NOT EXISTS \(\s+SELECT 1 FROM pg_trigger[\s\S]*CREATE OR REPLACE TRIGGER trg_maintenance_schedules_touch\s+BEFORE UPDATE ON maintenance_schedules/);
    expect(sql).toContain("NEW.updated_at := now();");
    expect(getTableConfig(maintenanceSchedules).columns.map((c) => c.name)).toContain("updated_at");
    expect(Object.keys(insertMaintenanceScheduleSchema.shape)).not.toContain("updatedAt");
    expect(VEHICLE_DEACTIVATIONS.find((d) => d.table === "maintenance_schedules")?.stampColumn).toBe("updated_at");
  });

  it("le client ne peut pas écrire l'auteur de la suppression", () => {
    expect(Object.keys(insertVehicleSchema.shape)).not.toContain("deletedBy");
  });
});
