import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { missionPodFiles } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261110_mission_pod_files.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const MISSION_POD_FILES_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("POD : mission_pod_files, init-database, migration jumelle et Drizzle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("création idempotente, verrou consultatif en tête", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mission_pod_files \(/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS mission_pod_files_mission_idx/);
  });

  it("chaque colonne et chaque contrainte Drizzle existe dans le SQL, sous le même nom", () => {
    const sql = fromMigration();
    const config = getTableConfig(missionPodFiles);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\n  ${column.name} `));
    const names = [
      ...config.checks.map((c) => c.name),
      ...config.foreignKeys.map((fk) => fk.getName()),
      ...config.uniqueConstraints.map((u) => u.name),
    ];
    expect(names).toContain("mission_pod_files_mission_sha256_unique");
    for (const name of names) expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
  });

  it("la réconciliation au démarrage relit les trois contraintes", () => {
    const src = readFileSync("server/init-database.ts", "utf8");
    for (const name of ["mission_pod_files_mime_check", "mission_pod_files_size_check", "mission_pod_files_mission_sha256_unique"]) {
      expect(src, name).toContain(`  '${name}',`);
    }
  });
});
