import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VEHICLE_DOCUMENT_TYPE_SEED, vehicleDocumentTypeSeedSql } from "../../../shared/constants/vehicle-document-types";

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
  // Une entrée est un gabarit littéral, ou la graine des types de document rendue depuis la constante partagée.
  return [...block.matchAll(/`([\s\S]*?)`,|^\s*(VEHICLE_DOCUMENT_TYPE_SEED_SQL),$/gm)].map((m) =>
    m[2] ? vehicleDocumentTypeSeedSql() : m[1].replace(/\\/g, "\\").replace(/\`/g, "`").trim(),
  );
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

  it("sème les 11 types de la constante partagée, valeurs inchangées, et le prix 828", () => {
    const all = fromMigration().join("\n");
    expect(VEHICLE_DOCUMENT_TYPE_SEED).toHaveLength(11);
    expect(fromMigration()).toContain(vehicleDocumentTypeSeedSql());
    for (const code of ["carte_grise", "carte_bleue", "visite_technique", "acf", "tae", "vignette", "jaugeage", "assurance", "agrement_pd", "taxe", "autre"]) {
      expect(all).toContain(`'${code}'`);
    }
    expect(all).toContain("DATE '2000-01-01', 828");
  });
});
