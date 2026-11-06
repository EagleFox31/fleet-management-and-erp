import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { vehicleDocuments } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261106_vehicle_documents_type_fk.sql";
const FK = "vehicle_documents_type_vehicle_document_types_code_fk";

function fromMigration(): string {
  return norm(
    norm(readFileSync(MIGRATION, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const VEHICLE_DOCUMENTS_TYPE_FK_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("vehicle_documents.type → vehicle_document_types(code) : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration, sans interpolation", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
    expect(fromInitDatabase()).not.toContain("${");
  });

  it("FK posée NOT VALID si absente, jamais validée, sans cascade ni donnée touchée", () => {
    const sql = fromMigration().replace(/\s+/g, " ");
    expect(sql).toContain(`ADD CONSTRAINT ${FK} FOREIGN KEY (type) REFERENCES vehicle_document_types(code) NOT VALID;`);
    expect(sql).toMatch(new RegExp(`IF NOT EXISTS \\( SELECT 1 FROM pg_constraint WHERE conrelid = 'vehicle_documents'::regclass AND conname = '${FK}' \\) THEN`));
    expect(sql).not.toMatch(/VALIDATE|CASCADE|ON DELETE|ON UPDATE|UPDATE |DELETE |DROP |INSERT /);
    expect(sql).toMatch(/lock_not_available/);
  });

  it("clé unique sur code posée seulement si ni PK ni UNIQUE ne la couvre", () => {
    const sql = fromMigration().replace(/\s+/g, " ");
    expect(sql).toContain("c.contype IN ('p', 'u')");
    expect(sql).toContain("ADD CONSTRAINT vehicle_document_types_code_key UNIQUE (code);");
    expect(sql.indexOf("vehicle_document_types_code_key")).toBeLessThan(sql.indexOf(`ADD CONSTRAINT ${FK}`));
  });

  it("lock_timeout posé dans la transaction, avant tout ALTER TABLE", () => {
    const sql = fromMigration();
    const timeout = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(timeout).toBeGreaterThan(sql.indexOf("pg_advisory_xact_lock"));
    expect(timeout).toBeLessThan(sql.indexOf("ALTER TABLE"));
  });

  it("même nom de FK et même cible que Drizzle, sans action en cascade", () => {
    const fks = getTableConfig(vehicleDocuments).foreignKeys.filter((fk) => fk.reference().foreignTable && fk.getName() === FK);
    expect(fks).toHaveLength(1);
    const ref = fks[0].reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["type"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["code"]);
    expect(fks[0].onDelete ?? "no action").toBe("no action");
    expect(fks[0].onUpdate ?? "no action").toBe("no action");
  });

  it("plus d'enum TypeScript sur vehicle_documents.type : le référentiel grandit à chaud", () => {
    expect(vehicleDocuments.type.enumValues).toBeUndefined();
  });

  it("init-database applique le SQL puis relit l'écart, après les migrations rejouées", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(/await pool\.query\(VEHICLE_DOCUMENTS_TYPE_FK_SQL\);\n\s*await reportVehicleDocumentTypeGaps\(pool\);/);
    expect(src.indexOf("await applyMigrationSqlFiles();")).toBeLessThan(src.indexOf("await pool.query(VEHICLE_DOCUMENTS_TYPE_FK_SQL)"));
    expect(src.indexOf("await applyLotRecetteSchema();")).toBeLessThan(src.indexOf("await pool.query(VEHICLE_DOCUMENTS_TYPE_FK_SQL)"));
  });

  it("le rapport ne journalise qu'un nombre : ni valeur de type ni identifiant", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    const start = src.indexOf("export async function reportVehicleDocumentTypeGaps");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    // Seules projections lues : l'état de la contrainte, un compte, et le SELECT 1 du NOT EXISTS.
    expect(body.match(/SELECT \S+/g)).toEqual(["SELECT convalidated", "SELECT count(*)::int", "SELECT 1"]);
    expect(body).not.toMatch(/string_agg|array_agg|d\.id/);
  });
});
