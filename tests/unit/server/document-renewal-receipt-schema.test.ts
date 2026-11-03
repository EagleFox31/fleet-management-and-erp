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
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DELETE |DROP /);
  });

  it("contraintes posées seulement si absentes, mêmes noms et même expression que Drizzle", () => {
    const sql = fromMigration().replace(/\s+/g, " ");
    const { checks, foreignKeys } = getTableConfig(documentRenewalRequests);
    expect(checks.map((c) => c.name)).toContain("document_renewal_requests_receipt_complete");
    const fk = foreignKeys.find((f) => f.reference().columns[0].name === "receipt_uploaded_by");
    expect(fk?.getName()).toBe("document_renewal_requests_receipt_uploaded_by_users_id_fk");
    expect(sql).toMatch(/conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk' \) THEN/);
    expect(sql).toMatch(/conname = 'document_renewal_requests_receipt_complete' \) THEN/);
    expect(sql).toContain("CHECK ((receipt_valid_until IS NULL) = (receipt_file_path IS NULL))");
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
