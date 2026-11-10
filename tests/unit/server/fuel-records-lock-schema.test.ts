import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261110_money_lock_fuel.sql";

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
  const marker = "export const FUEL_RECORDS_VALIDATED_LOCK_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("pleins validés verrouillés : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration, et l'applique au démarrage", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
    expect(readFileSync("server/init-database.ts", "utf8")).toContain("await pool.query(FUEL_RECORDS_VALIDATED_LOCK_SQL);");
  });

  it("le gabarit TypeScript ne transforme pas le SQL : ni interpolation ni échappement", () => {
    const sql = fromInitDatabase();
    expect(sql).not.toContain("${");
    expect(sql).not.toContain("\\");
  });

  it("idempotent, verrou de migration en tête, contrainte nommée, aucune donnée touchée", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION fn_fuel_records_validated_lock()");
    expect(sql).toContain("CREATE OR REPLACE TRIGGER trg_fuel_records_validated_lock\nBEFORE UPDATE OR DELETE ON fuel_records");
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).toContain("ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked'");
    expect(sql).not.toMatch(/\bUPDATE fuel_records|\bDELETE FROM|\bINSERT |\bALTER TABLE/);
  });

  it("liste blanche D2 : seules les colonnes d'horodatage, de mission et d'annulation échappent au gel", () => {
    const sql = fromMigration();
    expect(sql).toContain(
      "free_cols text[] := ARRAY['updated_at', 'updated_by', 'mission_id', 'deleted_at', 'deleted_by', 'cancellation_reason'];",
    );
    expect(sql).toContain("current_setting('fleetos.allow_money_override', true) = 'on'");
    expect(sql).toContain("char_length(NEW.cancellation_reason) > 500");
  });
});
