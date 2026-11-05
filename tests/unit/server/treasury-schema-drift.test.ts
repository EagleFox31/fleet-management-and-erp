import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { treasuryAccounts, treasuryEntries } from "../../../shared/schema";

// Contraintes de trésorerie : mêmes noms dans Drizzle, dans le SQL de démarrage et dans la liste relue
// (sinon drizzle-kit push en pose une seconde, ou la réconciliation en oublie une sans le dire).

const src = readFileSync("server/init-database.ts", "utf8").replace(/\r\n/g, "\n");
const block = src.slice(src.indexOf("export const TREASURY_SCHEMA_STATEMENTS"), src.indexOf("async function applyTreasurySchema"));

function drizzleNames(): string[] {
  const names: string[] = [];
  for (const table of [treasuryAccounts, treasuryEntries]) {
    const { checks, columns, uniqueConstraints } = getTableConfig(table);
    names.push(...checks.map((c) => c.name));
    names.push(...uniqueConstraints.map((u) => u.getName()));
    for (const column of columns) if (column.isUnique) names.push(column.uniqueName!);
  }
  return names.sort();
}

function listedNames(): string[] {
  const list = block.slice(block.indexOf("TREASURY_RECONCILED_CONSTRAINTS"));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("schéma trésorerie : contraintes nommées pareil partout", () => {
  it("Drizzle et la liste relue au démarrage portent les mêmes noms", () => {
    expect(drizzleNames()).toEqual(listedNames());
    expect(listedNames()).toHaveLength(6);
  });

  it("chaque contrainte est posée par CREATE TABLE et réconciliée par le bloc DO", () => {
    const [creates, reconcile] = [block.slice(0, block.indexOf("DO $$")), block.slice(block.indexOf("DO $$"))];
    for (const name of listedNames()) {
      expect(creates, name).toContain(`CONSTRAINT ${name} `);
      expect(reconcile, name).toContain(`'${name}'`);
    }
  });

  it("la CHECK de catégorie est tirée du contrat partagé, pas recopiée", () => {
    expect(src).toMatch(/TREASURY_CATEGORY_CHECK = `category IN \(\$\{TREASURY_CATEGORIES\.map/);
    expect(block).toContain("CHECK (${TREASURY_CATEGORY_CHECK})");
  });

  it("reste additif : aucun DROP", () => {
    expect(block).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/i);
  });
});
