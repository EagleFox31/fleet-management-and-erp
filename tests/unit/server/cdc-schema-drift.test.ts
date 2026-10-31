import { readFileSync } from "node:fs";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  idempotencyKeys,
  importBatches,
  vehicleImports,
  workOrderPlanning,
  workshopLaborRates,
} from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string[] {
  const body = norm(readFileSync("server/db/migrations/20261101_cdc_ecarts.sql", "utf8"))
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  return body.split(/;\n\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
}

function fromInitDatabase(): string[] {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const start = src.indexOf("CDC_SCHEMA_STATEMENTS: readonly string[] = [");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/`([\s\S]*?)`,/g)].map((m) => m[1].trim());
}

const NEW_TABLES: PgTable[] = [workshopLaborRates, importBatches, idempotencyKeys];
const COMPANION_TABLES: PgTable[] = [workOrderPlanning, vehicleImports];

describe("schéma CDC : migration et init-database.ts identiques (AGENTS.md §5)", () => {
  const statements = fromMigration();

  it("les deux listes d'ordres SQL concordent, verrou consultatif en tête", () => {
    expect(statements.length).toBeGreaterThan(15);
    expect(fromInitDatabase()).toEqual(statements);
    expect(statements[0]).toBe("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))");
  });

  it("init-database applique le schéma CDC juste après celui du lot recette", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(/await applyLotRecetteSchema\(\);\n\s*await applyCdcSchema\(\);/);
  });

  it("chaque table Drizzle neuve est créée en SQL avec toutes ses colonnes", () => {
    for (const table of NEW_TABLES) {
      const { name, columns } = getTableConfig(table);
      const create = statements.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
      expect(create, name).toBeDefined();
      for (const column of columns) {
        expect(create, `${name}.${column.name}`).toMatch(new RegExp(`\\n  ${column.name} `));
      }
    }
  });

  it("chaque colonne d'une table compagne est ajoutée par ALTER TABLE … ADD COLUMN IF NOT EXISTS", () => {
    for (const table of COMPANION_TABLES) {
      const { name, columns } = getTableConfig(table);
      for (const column of columns.filter((c) => c.name !== "id")) {
        expect(
          statements.some((s) => s.startsWith(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${column.name} `)),
          `${name}.${column.name}`,
        ).toBe(true);
      }
    }
  });

  it("reste additif : aucun DROP, aucun ALTER TYPE, aucune colonne ajoutée NOT NULL", () => {
    const all = statements.join("\n");
    expect(all).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TRIGGER)\b/i);
    expect(all).not.toMatch(/ALTER\s+TYPE|ALTER\s+COLUMN/i);
    for (const s of statements.filter((x) => /ADD COLUMN/i.test(x))) {
      expect(s, s).not.toMatch(/NOT NULL/i);
    }
  });

  it("aucun taux horaire semé", () => {
    expect(statements.join("\n")).not.toMatch(/INSERT INTO workshop_labor_rates/i);
  });
});

describe("triggers d'effets de bord : garde fleetos.suppress_side_effects (CDC #9)", () => {
  const FILES = [
    "work-orders-alerts-triggers.sql",
    "work-orders-realtime-triggers.sql",
    "vehicle-alerts-triggers.sql",
    "maintenance-schedules-alerts-triggers.sql",
  ];

  it.each(FILES)("%s : chaque fonction de trigger sort tôt quand la variable vaut 'on'", (file) => {
    const src = norm(readFileSync(`server/db/triggers/${file}`, "utf8"));
    const bodies = src.split(/RETURNS TRIGGER AS \$\$/).slice(1);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const afterBegin = body.slice(body.search(/\nBEGIN\n/) + "\nBEGIN\n".length);
      const firstStatement = afterBegin.split("\n").find((l) => l.trim() && !l.trim().startsWith("--"));
      expect(firstStatement?.trim()).toMatch(
        /^IF current_setting\('fleetos\.suppress_side_effects', true\) = 'on' THEN/,
      );
    }
  });
});
