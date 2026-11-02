import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** SINV1 : colonnes de rejet d'un règlement créées de façon idempotente au démarrage (AGENTS.md §5, règle schéma). */
const STATEMENTS = [
  /ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_by integer REFERENCES users\(id\)/,
  /ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_at timestamp/,
  /ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejection_reason text/,
];

describe("rejet de règlement fournisseur : init-database et migration jumelle", () => {
  it.each([
    ["server/init-database.ts"],
    ["server/db/migrations/20261101_supplier_settlement_rejection.sql"],
  ])("%s crée les trois colonnes avec IF NOT EXISTS", (file) => {
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, "utf8").replace(/\s+/g, " ");
    for (const statement of STATEMENTS) expect(src).toMatch(statement);
  });
});
