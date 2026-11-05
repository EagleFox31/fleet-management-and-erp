import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { missionBudgets } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261105_mission_budgets.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const MISSION_BUDGETS_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("L1 : mission_budgets, init-database, migration jumelle et Drizzle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("création idempotente, verrou consultatif en tête", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mission_budgets \(/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mission_budgets_budget_date/);
  });

  it("chaque colonne et chaque contrainte Drizzle existe dans le SQL, sous le même nom", () => {
    const sql = fromMigration();
    const config = getTableConfig(missionBudgets);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\\n  ${column.name} `));
    const names = [
      ...config.checks.map((c) => c.name),
      ...config.foreignKeys.map((fk) => fk.getName()),
      "mission_budgets_mission_id_unique",
    ];
    for (const name of names) expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
  });

  it("colonnes d'audit présentes, lien trésorerie nullable sans FK (branché après T1)", () => {
    const sql = fromMigration();
    for (const col of ["created_by", "updated_by", "created_at", "updated_at"]) expect(sql).toContain(`  ${col} `);
    expect(sql).toMatch(/\n  treasury_entry_id integer,\n/);
  });
});
