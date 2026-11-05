import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { missions } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));
const migration = () =>
  norm(
    norm(readFileSync("server/db/migrations/20261106_mission_agreed_price.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function initSql(): string {
  const src = initSource();
  const marker = "export const MISSION_AGREED_PRICE_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("O3 lot 3 : missions.agreed_price et tariff_grid_id", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(initSql()).toBe(migration());
  });

  it("colonnes nullables, verrou en tête, FK NOT VALID puis validée, aucune suppression ni rétro-remplissage", () => {
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("ADD COLUMN agreed_price numeric(15,0);");
    expect(sql).toContain("ADD COLUMN tariff_grid_id integer;");
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("FOREIGN KEY (tariff_grid_id) REFERENCES tariff_grid(id) ON DELETE SET NULL NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT missions_tariff_grid_id_tariff_grid_id_fk");
    expect(sql.replace("ON DELETE SET NULL", "")).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE |INSERT /);
  });

  it("Drizzle : mêmes colonnes, prix en XAF entier, FK SET NULL sous le nom du SQL", () => {
    const config = getTableConfig(missions);
    const price = config.columns.find((c) => c.name === "agreed_price") as unknown as { scale: number; notNull: boolean };
    expect(price.scale).toBe(0);
    expect(price.notNull).toBe(false);
    const fk = config.foreignKeys.find((f) => f.getName() === "missions_tariff_grid_id_tariff_grid_id_fk");
    expect(fk?.onDelete).toBe("set null");
  });

  it("le SQL jumeau passe après tariff_grid et la FK est relue par reportCdcConstraintGaps", () => {
    const src = initSource();
    const run = src.indexOf("await pool.query(MISSION_AGREED_PRICE_SQL);");
    expect(run).toBeGreaterThan(src.indexOf("await pool.query(TARIFF_GRID_SQL);"));
    expect(run).toBeLessThan(src.indexOf("await reportCdcConstraintGaps(pool);"));
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    expect(src.slice(listStart, src.indexOf("];", listStart))).toContain("'missions_tariff_grid_id_tariff_grid_id_fk'");
  });
});
