import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { clientInvoices, clients, insertClientInvoiceSchema, insertClientSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const MIGRATION = "server/db/migrations/20261105_finance_withholding.sql";

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
  const marker = "export const FINANCE_WITHHOLDING_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).columns.map((c) => c.name);

describe("Retenues à la source (F1) : init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("init-database l'applique au démarrage", () => {
    expect(norm(readFileSync("server/init-database.ts", "utf8"))).toContain("await pool.query(FINANCE_WITHHOLDING_SQL);");
  });

  it("colonnes et CHECK idempotents, sans rien supprimer ni réécrire", () => {
    const sql = fromMigration();
    for (const col of ["withholding_vat_rate", "withholding_is_rate", "withholding_is_base", "withholding_updated_by"]) {
      expect(sql).toContain(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${col} `);
    }
    for (const col of ["deposited_at", "deposited_by", "withholding_vat_amount", "withholding_is_amount", "net_payable"]) {
      expect(sql).toContain(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS ${col} `);
    }
    expect(sql).toContain("NOT VALID");
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
    // CHECK posés NOT VALID puis validés ; une ligne hors contrainte laisse un WARNING, pas un échec.
    expect(sql).toContain("VALIDATE CONSTRAINT");
    expect(sql).toContain("EXCEPTION WHEN check_violation THEN");
    // Auteurs : FK non bloquantes, la suppression d'un compte ne bloque ni n'efface la donnée finance.
    for (const fk of ["client_invoices_deposited_by_users_id_fk", "clients_withholding_updated_by_users_id_fk"]) {
      expect(sql).toContain(`'${fk}'`);
    }
    expect(sql).toContain("REFERENCES users(id) ON DELETE SET NULL");
    expect(sql).not.toMatch(/DELETE FROM|^s*UPDATE |DROP |TRUNCATE /m);
  });

  it("le schéma Drizzle déclare les mêmes colonnes et CHECK", () => {
    expect(columnsOf(clients)).toEqual(expect.arrayContaining(["withholding_vat_rate", "withholding_is_rate", "withholding_is_base"]));
    expect(columnsOf(clientInvoices)).toEqual(
      expect.arrayContaining(["deposited_at", "withholding_vat_amount", "withholding_is_amount", "net_payable"]),
    );
    const checks = getTableConfig(clients).checks.map((c) => c.name).sort();
    expect(checks).toEqual(["clients_withholding_is_base_check", "clients_withholding_is_rate_check", "clients_withholding_vat_rate_check"]);
    for (const name of checks) expect(fromMigration()).toContain(`'${name}'`);
  });

  it("la fiche client et la création de facture ne peuvent pas écrire ces champs", () => {
    const clientKeys = Object.keys(insertClientSchema.shape);
    for (const k of ["withholdingVatRate", "withholdingIsRate", "withholdingIsBase", "withholdingUpdatedBy"]) expect(clientKeys).not.toContain(k);
    const invoiceKeys = Object.keys(insertClientInvoiceSchema.shape);
    for (const k of ["depositedAt", "depositedBy", "withholdingVatAmount", "withholdingIsAmount", "netPayable"]) expect(invoiceKeys).not.toContain(k);
  });
});
