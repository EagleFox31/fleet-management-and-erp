import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string[] {
  const body = norm(readFileSync("server/db/migrations/20261031_lot_recette.sql", "utf8"))
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  return body.split(/;\n\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
}

function fromInitDatabase(): string[] {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const start = src.indexOf("LOT_RECETTE_SCHEMA_STATEMENTS: readonly string[] = [");
  const end = src.indexOf("\n];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/`([\s\S]*?)`,/g)].map((m) => m[1].replace(/\\/g, "\\").replace(/\`/g, "`").trim());
}

describe("schéma du lot recette : migration et init-database.ts identiques (AGENTS.md §5)", () => {
  it("les deux listes d'ordres SQL concordent", () => {
    const a = fromMigration();
    const b = fromInitDatabase();
    expect(a.length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  });

  it("reste additif : aucun DROP ni ALTER TYPE", () => {
    const all = fromMigration().join("\n");
    expect(all).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(all).not.toMatch(/ALTER\s+TYPE/i);
  });

  it("sème les 9 types de document et le prix 828", () => {
    const all = fromMigration().join("\n");
    for (const code of ["carte_grise", "carte_bleue", "visite_technique", "acf", "tae", "vignette", "jaugeage", "assurance", "agrement_pd"]) {
      expect(all).toContain(`'${code}'`);
    }
    expect(all).toContain("DATE '2000-01-01', 828");
  });
});
