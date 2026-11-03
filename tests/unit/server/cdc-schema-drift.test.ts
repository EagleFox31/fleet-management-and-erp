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

  it("chaque colonne d'une table compagne est ajoutée en SQL (ADD COLUMN IF NOT EXISTS, ou dans un bloc DO gardé)", () => {
    for (const table of COMPANION_TABLES) {
      const { name, columns } = getTableConfig(table);
      for (const column of columns.filter((c) => c.name !== "id")) {
        const direct = `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${column.name} `;
        const guarded = `ALTER TABLE ${name} ADD COLUMN ${column.name} `;
        expect(
          statements.some((s) => s.startsWith(direct) || (s.startsWith("DO $$") && s.includes(guarded))),
          `${name}.${column.name}`,
        ).toBe(true);
      }
    }
  });

  it("reprise de due_date : un seul passage, dans le bloc qui crée la colonne, sans notification temps réel", () => {
    const backfills = statements.filter((s) => /UPDATE work_orders SET due_date/.test(s));
    expect(backfills).toHaveLength(1);
    const block = backfills[0];
    // Sortie anticipée si la colonne existe déjà : aucun démarrage suivant ne réécrit due_date.
    const exit = block.indexOf("column_name = 'due_date'");
    const returned = block.indexOf("RETURN;", exit);
    const add = block.indexOf("ALTER TABLE work_orders ADD COLUMN due_date date");
    const update = block.indexOf("UPDATE work_orders SET due_date");
    expect(exit).toBeGreaterThan(-1);
    expect(returned).toBeGreaterThan(exit);
    expect(add).toBeGreaterThan(returned);
    expect(update).toBeGreaterThan(add);
    // La reprise ne filtre plus sur due_date IS NULL : elle ne sert qu'au passage de création.
    expect(block).not.toMatch(/due_date IS NULL/);
    // Trigger temps réel suspendu autour de l'UPDATE, puis rétabli dans la même transaction.
    const disable = block.indexOf("DISABLE TRIGGER trigger_work_orders_realtime_notify");
    const enable = block.indexOf("ENABLE TRIGGER trigger_work_orders_realtime_notify");
    expect(disable).toBeGreaterThan(add);
    expect(disable).toBeLessThan(update);
    expect(enable).toBeGreaterThan(update);
    expect(block).toMatch(/tgenabled = 'O'/);
    // Aucun autre ordre n'ajoute due_date (sinon la colonne existerait avant le bloc).
    expect(statements.filter((s) => /ADD COLUMN (IF NOT EXISTS )?due_date\b/.test(s))).toHaveLength(1);
    expect(statements.indexOf(block)).toBeLessThan(
      statements.findIndex((s) => s.includes("work_orders_preventive_due_idx")),
    );
  });

  it("immatriculation : index NON unique seulement, doublons signalés par WARNING", () => {
    const all = statements.join("\n");
    expect(all).not.toMatch(/UNIQUE INDEX[^;]*vehicles_registration/i);
    expect(all).not.toMatch(/vehicles_registration_key_uidx/);
    const block = statements.find((s) => s.includes("vehicles_registration_key_idx"));
    expect(block).toBeDefined();
    expect(block).toMatch(/CREATE INDEX vehicles_registration_key_idx/);
    expect(block).toMatch(/RAISE WARNING 'vehicles : % immatriculation/);
  });

  it("reste additif : aucun DROP, aucun ALTER TYPE, aucune colonne ajoutée NOT NULL", () => {
    const all = statements.join("\n");
    expect(all).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TRIGGER)\b/i);
    expect(all).not.toMatch(/ALTER\s+TYPE|ALTER\s+COLUMN/i);
    const addColumnLines = all.split("\n").filter((line) => /ADD COLUMN/i.test(line));
    expect(addColumnLines.length).toBeGreaterThan(0);
    for (const line of addColumnLines) {
      expect(line, line).not.toMatch(/NOT NULL/i);
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
