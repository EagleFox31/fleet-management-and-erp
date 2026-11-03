import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261102_parts_catalog_children.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const PARTS_CATALOG_CHILDREN_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("PRT1 / CAT2 : tables du catalogue de pièces, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("reste idempotent et additif : IF NOT EXISTS partout, aucun DROP de table ou de colonne", () => {
    const sql = fromMigration();
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    for (const table of ["part_specifications", "part_variants", "fault_catalog", "fault_catalog_parts"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_fault_catalog_parts_fault_part");
  });

  it("dédoublonne avant de poser l'index unique du couple (panne, pièce)", () => {
    const sql = fromMigration();
    expect(sql.indexOf("DELETE FROM fault_catalog_parts")).toBeGreaterThan(-1);
    expect(sql.indexOf("DELETE FROM fault_catalog_parts")).toBeLessThan(sql.indexOf("ux_fault_catalog_parts_fault_part"));
  });
});
