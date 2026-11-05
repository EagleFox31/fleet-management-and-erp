import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { qhseInspectionCriteria, qhseInspections } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261105_qhse_inspections.sql";

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
  const marker = "export const QHSE_INSPECTIONS_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("lot Q1 : contrôles inopinés QHSE, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage", () => {
    expect(initSource()).toMatch(/await pool\.query\(QHSE_INSPECTIONS_SQL\);/);
  });

  it("additif et idempotent : IF NOT EXISTS partout, aucune suppression ni mise à jour", () => {
    const sql = fromMigration();
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS qhse_inspection_criteria");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS qhse_inspections");
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(sql).toContain("ON CONFLICT (code) DO NOTHING");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("le semis ne reprend que des critères du document QHSE (aucune grille inventée)", () => {
    const codes = [...fromMigration().matchAll(/\('((?:cabin|stop)_[a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.filter((c) => c.startsWith("cabin_"))).toHaveLength(10);
    expect(codes.filter((c) => c.startsWith("stop_"))).toHaveLength(6);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("le schéma Drizzle déclare les mêmes colonnes que le SQL", () => {
    const criteria = getTableConfig(qhseInspectionCriteria).columns.map((c) => c.name).sort();
    expect(criteria).toEqual(
      ["active", "category", "code", "created_at", "created_by", "id", "label", "sort_order", "updated_at", "updated_by"].sort(),
    );
    const inspections = getTableConfig(qhseInspections).columns.map((c) => c.name).sort();
    expect(inspections).toEqual(
      [
        "created_at", "created_by", "driver_id", "general_observation", "id", "inspected_at", "inspector_id",
        "items", "kind", "location", "updated_at", "updated_by", "vehicle_id",
      ].sort(),
    );
    const indexes = getTableConfig(qhseInspections).indexes.map((i) => i.config.name).sort();
    expect(indexes).toEqual(["idx_qhse_inspections_driver", "idx_qhse_inspections_vehicle"]);
  });
});
