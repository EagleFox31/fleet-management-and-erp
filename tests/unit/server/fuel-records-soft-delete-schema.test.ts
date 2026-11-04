import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { fuelRecords, insertFuelRecordSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n");
const MIGRATION = "server/db/migrations/20261103_fuel_records_soft_delete.sql";

/** Instructions ALTER de la migration, sans commentaires. */
function alterStatements(source: string): string[] {
  return norm(source)
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.startsWith("ALTER TABLE"));
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function initDatabaseAlters(): string[] {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  return [...src.matchAll(/sql`(ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS (?:deleted_at|deleted_by)[^`]*)`/g)].map((m) =>
    m[1].trim().replace(/\s+/g, " "),
  );
}

describe("Suppression douce des pleins : init-database et migration jumelle", () => {
  it("init-database porte les mêmes ALTER que la migration", () => {
    expect(initDatabaseAlters()).toEqual(alterStatements(readFileSync(MIGRATION, "utf8")));
    expect(initDatabaseAlters()).toHaveLength(2);
  });

  it("colonnes idempotentes, sans rien supprimer", () => {
    const sql = norm(readFileSync(MIGRATION, "utf8"));
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS deleted_at timestamp");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id)");
    expect(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("le schéma Drizzle déclare les deux colonnes", () => {
    const names = getTableConfig(fuelRecords).columns.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["deleted_at", "deleted_by"]));
  });

  it("le client ne peut pas écrire la suppression par le schéma d'insertion", () => {
    expect(Object.keys(insertFuelRecordSchema.shape)).not.toContain("deletedAt");
    expect(Object.keys(insertFuelRecordSchema.shape)).not.toContain("deletedBy");
  });

  it("les triggers carburant ignorent les lignes supprimées", () => {
    const mission = norm(readFileSync("server/db/triggers/mission-fuel-triggers.sql", "utf8"));
    expect(mission.match(/fr\.deleted_at IS NULL/g)).toHaveLength(2);
    expect(norm(readFileSync("server/db/triggers/fuel-alerts-triggers.sql", "utf8")).match(/deleted_at IS NULL/g)).toHaveLength(3);
  });

  it("fuel-alerts-triggers.sql est posé au démarrage, réécrit (sans AVG(LAG), ni %.1f, ni user_id en dur, alerte en échec rattrapée)", () => {
    expect(readFileSync("server/init-database.ts", "utf8")).toMatch(/BOOTSTRAP_SQL_FILES = \[[^\]]*'fuel-alerts-triggers\.sql'/);
    const sql = norm(readFileSync("server/db/triggers/fuel-alerts-triggers.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/AVG\s*\([^)]*LAG/i);
    expect(sql).not.toContain("%.1f");
    expect(sql).not.toMatch(/VALUES\s*\(\s*1\s*,/);
    expect(sql).not.toContain("create_vehicle_alert");
    expect(sql.match(/EXCEPTION WHEN OTHERS THEN\n\s*RAISE WARNING/g)).toHaveLength(2);
    expect(sql.match(/^CREATE (?!OR REPLACE|TABLE IF NOT EXISTS)/gm)).toBeNull();
  });
});
