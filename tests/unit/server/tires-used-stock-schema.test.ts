import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stock pneu usagé : colonnes créées de façon idempotente au démarrage (AGENTS.md §5, règle schéma). */
const STATEMENTS = [
  /ALTER TABLE tires ADD COLUMN IF NOT EXISTS used_stock_quantity integer NOT NULL DEFAULT 0/,
  /ALTER TABLE vehicle_tires ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'new'/,
];

describe("stock pneu usagé : init-database et migration jumelle", () => {
  it.each([
    ["server/init-database.ts"],
    ["server/db/migrations/20261101_tires_used_stock.sql"],
  ])("%s crée les deux colonnes avec IF NOT EXISTS", (file) => {
    const src = readFileSync(file, "utf8").replace(/\s+/g, " ");
    for (const statement of STATEMENTS) expect(src).toMatch(statement);
  });
});
