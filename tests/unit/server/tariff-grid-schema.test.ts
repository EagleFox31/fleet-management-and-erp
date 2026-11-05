import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { tariffGrid } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));

const migration = () =>
  norm(
    norm(readFileSync("server/db/migrations/20261106_tariff_grid.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function initSql(): string {
  const src = initSource();
  const marker = "export const TARIFF_GRID_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("O3 : tariff_grid, init-database, migration jumelle et Drizzle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(initSql()).toBe(migration());
  });

  it("création idempotente, verrou consultatif en tête, aucune suppression", () => {
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tariff_grid (");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS tariff_grid_key_unique");
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("unit_price numeric(15,0)");
    expect(sql).toContain("WHERE active;");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("chaque colonne et chaque contrainte Drizzle existe dans le SQL, sous le même nom", () => {
    const sql = migration();
    const config = getTableConfig(tariffGrid);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\\n  ${column.name} `));
    const names = [...config.checks.map((c) => c.name), ...config.foreignKeys.map((fk) => fk.getName())];
    for (const name of names) expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
  });

  it("l'unicité traite le tarif générique (client NULL) comme un client", () => {
    const config = getTableConfig(tariffGrid);
    expect(config.indexes.map((i) => i.config.name)).toContain("tariff_grid_key_unique");
    expect(migration()).toContain("(CASE WHEN client_id IS NULL THEN 0 ELSE client_id END)");
  });

  it("CHECK : mêmes noms dans Drizzle, dans le SQL (création et réconciliation) et dans CDC_RECONCILED_CONSTRAINTS", () => {
    const declared = getTableConfig(tariffGrid).checks.map((c) => c.name).sort();
    expect(declared).toEqual(["tariff_grid_period_check", "tariff_grid_pricing_unit_check", "tariff_grid_unit_price_check"]);
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    const reconciled = src.slice(listStart, src.indexOf("];", listStart));
    const sql = migration();
    for (const name of declared) {
      expect(sql, name).toContain(`('${name}', 'CHECK (`);
      expect(reconciled, name).toContain(`'${name}'`);
    }
    expect(sql).toContain("ADD CONSTRAINT %I %s NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT %I");
  });

  it("l'écart de contraintes est relu après la création de tariff_grid", () => {
    const src = initSource();
    expect(src.indexOf("await pool.query(TARIFF_GRID_SQL);")).toBeGreaterThan(-1);
    expect(src.indexOf("await pool.query(TARIFF_GRID_SQL);")).toBeLessThan(src.indexOf("await reportCdcConstraintGaps(pool);"));
  });
});
