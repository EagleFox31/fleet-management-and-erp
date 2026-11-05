import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { missionPriceHistory } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));
const migration = () =>
  norm(
    norm(readFileSync("server/db/migrations/20261106_mission_price_history.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function initSql(): string {
  const src = initSource();
  const marker = "export const MISSION_PRICE_HISTORY_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("O3 lot 3b : mission_price_history", () => {
  it("init-database porte exactement le SQL de la migration jumelle", () => {
    expect(initSql()).toBe(migration());
  });
  it("idempotent, verrou consultatif et lock_timeout, aucune instruction destructive", () => {
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mission_price_history (");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS mission_price_history_mission_idx");
    expect(sql.replace(/ON DELETE CASCADE/g, "")).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });
  it("chaque colonne, contrainte et index Drizzle existe dans le SQL sous le même nom", () => {
    const sql = migration();
    const config = getTableConfig(missionPriceHistory);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\n  ${column.name} `));
    for (const name of [...config.checks.map((c) => c.name), ...config.foreignKeys.map((fk) => fk.getName())]) {
      expect(sql, name).toContain(`CONSTRAINT ${name} `);
    }
    for (const index of config.indexes) expect(sql, index.config.name).toContain(index.config.name);
  });
  it("prix en XAF entier (échelle 0) et création lancée au démarrage", () => {
    for (const c of getTableConfig(missionPriceHistory).columns.filter((c) => c.name.endsWith("_price"))) {
      expect((c as unknown as { scale: number }).scale, c.name).toBe(0);
    }
    const src = initSource();
    expect(src).toContain("await pool.query(MISSION_PRICE_HISTORY_SQL);");
    expect(src.indexOf("await pool.query(MISSION_PRICE_HISTORY_SQL);")).toBeGreaterThan(src.indexOf("await pool.query(MISSION_AGREED_PRICE_SQL);"));
  });
});
