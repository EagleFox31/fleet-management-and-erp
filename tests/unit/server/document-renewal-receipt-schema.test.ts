import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { documentRenewalRequests, insertDocumentRenewalRequestSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261103_document_renewal_receipt.sql";

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
  const marker = "export const DOCUMENT_RENEWAL_RECEIPT_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

const RECEIPT_COLUMNS = {
  receipt_valid_until: "date",
  receipt_file_name: "text",
  receipt_file_path: "text",
  receipt_uploaded_at: "timestamp",
  receipt_uploaded_by: "integer",
} as const;

describe("P3-2 : récépissé de renouvellement, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database applique le SQL au démarrage, hors du schéma CDC", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(/await pool\.query\(DOCUMENT_RENEWAL_RECEIPT_SQL\)/);
    const cdc = src.slice(src.indexOf("CDC_SCHEMA_STATEMENTS: readonly string[] = ["));
    expect(cdc.slice(0, cdc.indexOf("\n];"))).not.toMatch(/receipt_/);
  });

  it("chaque colonne Drizzle est ajoutée nullable avec IF NOT EXISTS, au bon type", () => {
    const sql = fromMigration();
    const { columns } = getTableConfig(documentRenewalRequests);
    for (const [name, type] of Object.entries(RECEIPT_COLUMNS)) {
      const column = columns.find((c) => c.name === name);
      expect(column, name).toBeDefined();
      expect(column!.notNull, name).toBe(false);
      expect(column!.hasDefault, name).toBe(false);
      expect(sql).toContain(`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS ${name} ${type};`);
    }
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DELETE |DROP COLUMN|DROP TABLE/);
    // Seul DROP admis : l'ancienne CHECK de même nom, dans le bloc qui la repose aussitôt.
    expect(sql.match(/DROP /g)).toHaveLength(1);
    expect(sql).toContain("DROP CONSTRAINT document_renewal_requests_receipt_complete;");
  });

  it("FK et CHECK dans deux blocs DO distincts, chacun posé seulement si absent", () => {
    const blocks = fromMigration().split("DO $$").slice(1).map((b) => b.replace(/\s+/g, " "));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatch(/ADD COLUMN IF NOT EXISTS receipt_valid_until/);
    expect(blocks[0]).not.toMatch(/CONSTRAINT/);
    expect(blocks[1]).toMatch(/conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk' \) THEN/);
    expect(blocks[1]).not.toMatch(/receipt_complete/);
    expect(blocks[2]).toMatch(/IF NOT EXISTS \( SELECT 1 FROM pg_constraint .* conname = 'document_renewal_requests_receipt_complete' \) THEN/);
    expect(blocks[2]).not.toMatch(/FOREIGN KEY/);
    // Chaque avertissement cite la contrainte par son nom.
    expect(blocks[1].match(/RAISE WARNING '([^']*)'/g)!.every((w) => w.includes("receipt_uploaded_by_users_id_fk"))).toBe(true);
    expect(blocks[2].match(/RAISE WARNING '([^']*)'/g)!.every((w) => w.includes("receipt_complete"))).toBe(true);
    // Violation piégée seulement autour du VALIDATE, dans un sous-bloc (patron #124) : la contrainte reste
    // posée NOT VALID, l'autre bloc n'est pas concerné.
    expect(blocks[1]).toMatch(
      /BEGIN ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk; EXCEPTION WHEN foreign_key_violation THEN/,
    );
    expect(blocks[2]).toMatch(
      /BEGIN ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_complete; EXCEPTION WHEN check_violation THEN/,
    );
    expect(blocks[1].match(/foreign_key_violation/g)).toHaveLength(1);
    expect(blocks[2].match(/check_violation/g)).toHaveLength(1);
    // Un verrou de table indisponible ne fait pas échouer le démarrage.
    for (const block of blocks) expect(block).toMatch(/lock_not_available/);
  });

  it("lock_timeout posé dans la transaction, avant tout ALTER TABLE", () => {
    const sql = fromMigration();
    const timeout = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(timeout).toBeGreaterThan(sql.indexOf("pg_advisory_xact_lock"));
    expect(timeout).toBeLessThan(sql.indexOf("ALTER TABLE"));
  });

  it("mêmes noms et même expression que Drizzle ; receipt_uploaded_by hors CHECK", () => {
    const sql = fromMigration().replace(/\s+/g, " ");
    const { checks, foreignKeys } = getTableConfig(documentRenewalRequests);
    expect(checks.map((c) => c.name)).toContain("document_renewal_requests_receipt_complete");
    const fk = foreignKeys.find((f) => f.reference().columns[0].name === "receipt_uploaded_by");
    expect(fk?.getName()).toBe("document_renewal_requests_receipt_uploaded_by_users_id_fk");
    const expr = "num_nulls(receipt_valid_until, receipt_file_path, receipt_file_name, receipt_uploaded_at) IN (0, 4)";
    expect(sql).toContain(`CHECK (${expr})`);
    expect(expr).not.toMatch(/receipt_uploaded_by/);
  });

  it("init-database relit les contraintes après le SQL et journalise l'écart", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(
      /await pool\.query\(DOCUMENT_RENEWAL_RECEIPT_SQL\);\n\s*await reportDocumentRenewalReceiptGaps\(pool\);/,
    );
  });
});

describe("P3-2 : le corps de requête ne pose ni fichier ni traçabilité du récépissé", () => {
  const base = { vehicleId: 1, vehicleDocumentId: 1, documentType: "assurance" as const };

  it("receipt_uploaded_by, receipt_uploaded_at et le fichier sont ignorés, la date de validité passe", () => {
    const parsed = insertDocumentRenewalRequestSchema.parse({
      ...base,
      receiptValidUntil: "2026-12-31",
      receiptFileName: "recu.pdf",
      receiptFilePath: "../../etc/passwd",
      receiptUploadedAt: new Date(),
      receiptUploadedBy: 999,
    }) as Record<string, unknown>;
    expect(parsed.receiptValidUntil).toBe("2026-12-31");
    for (const key of ["receiptFileName", "receiptFilePath", "receiptUploadedAt", "receiptUploadedBy"]) {
      expect(parsed, key).not.toHaveProperty(key);
    }
  });

  it("contrat inchangé : une demande sans récépissé reste valide", () => {
    expect(insertDocumentRenewalRequestSchema.parse(base)).not.toHaveProperty("receiptValidUntil");
  });
});
