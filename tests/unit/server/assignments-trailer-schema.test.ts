import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assignments } from "../../../shared/schema";
import { TRAILER_ACTIVE_INDEX } from "../../../server/services/trailer-assignment";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261110_assignments_trailer.sql";

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
  const marker = "export const ASSIGNMENTS_TRAILER_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("remorque d'affectation : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage puis relit l'écart", () => {
    expect(initSource()).toMatch(/await pool\.query\(ASSIGNMENTS_TRAILER_SQL\);\s*await reportAssignmentsTrailerGaps\(pool\);/);
  });

  it("colonne idempotente, index unique partiel posé seulement sans doublon, verrou borné, sans rien corriger", () => {
    const sql = fromMigration();
    expect(sql).toContain("ALTER TABLE assignments ADD COLUMN IF NOT EXISTS trailer_id integer REFERENCES vehicles(id) ON DELETE SET NULL;");
    expect(sql).toContain(
      `CREATE UNIQUE INDEX ${TRAILER_ACTIVE_INDEX} ON assignments (trailer_id) WHERE trailer_id IS NOT NULL AND status IN ('pending', 'accepted', 'in_progress');`,
    );
    expect(sql).toContain("GROUP BY trailer_id HAVING count(*) > 1");
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available OR unique_violation THEN");
    expect(sql).not.toMatch(/^\s*(DELETE|UPDATE|DROP|TRUNCATE) /m);
  });

  it("le schéma Drizzle déclare la colonne et le même index partiel", () => {
    const config = getTableConfig(assignments);
    expect(config.columns.map((c) => c.name)).toContain("trailer_id");
    const index = config.indexes.find((i) => i.config.name === TRAILER_ACTIVE_INDEX);
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.columns.map((c) => (c as { name: string }).name)).toEqual(["trailer_id"]);
    expect(index!.config.where).toBeDefined();
  });
});
