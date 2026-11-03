import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { fuelRecords, insertFuelRecordSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261103_fuel_records_request_key.sql";

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
  const marker = "export const FUEL_RECORDS_REQUEST_KEY_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("Clé de requête des pleins de mission : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database l'applique au démarrage", () => {
    expect(norm(readFileSync("server/init-database.ts", "utf8"))).toContain("await pool.query(FUEL_RECORDS_REQUEST_KEY_SQL);");
  });

  it("colonne et index unique idempotents, sans rien supprimer", () => {
    const sql = fromMigration();
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS request_key text;");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_fuel_records_request_key ON fuel_records (request_key);");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("le schéma Drizzle déclare le même index unique", () => {
    const index = getTableConfig(fuelRecords).indexes.find((i) => i.config.name === "ux_fuel_records_request_key");
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.columns.map((c) => (c as { name: string }).name)).toEqual(["request_key"]);
  });

  it("le client ne peut pas écrire la clé par le schéma d'insertion", () => {
    expect(Object.keys(insertFuelRecordSchema.shape)).not.toContain("requestKey");
  });
});
