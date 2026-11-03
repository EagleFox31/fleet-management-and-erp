import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { drivers } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261103_drivers_user_id_unique.sql";

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
  const marker = "export const DRIVERS_USER_ID_UNIQUE_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("#113 : une fiche chauffeur par compte, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage puis relit l'écart", () => {
    const src = initSource();
    expect(src).toMatch(/await pool\.query\(DRIVERS_USER_ID_UNIQUE_SQL\);\s*await reportDriverUserIdUniqueGaps\(pool\);/);
  });

  it("index unique partiel, posé seulement sans doublon, sans rien supprimer", () => {
    const sql = fromMigration();
    expect(sql).toContain("CREATE UNIQUE INDEX uq_drivers_user_id ON drivers (user_id) WHERE user_id IS NOT NULL;");
    expect(sql).toContain("GROUP BY user_id HAVING count(*) > 1");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
  });

  it("le schéma Drizzle déclare le même index partiel", () => {
    const index = getTableConfig(drivers).indexes.find((i) => i.config.name === "uq_drivers_user_id");
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.columns.map((c) => (c as { name: string }).name)).toEqual(["user_id"]);
    expect(index!.config.where).toBeDefined();
  });
});
