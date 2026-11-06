import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { missionBudgetExpenses, missionBudgets, missionDestinations } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261105_mission_budgets.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const MISSION_BUDGETS_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("L1 : mission_budgets, init-database, migration jumelle et Drizzle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("création idempotente, verrou consultatif en tête", () => {
    const sql = fromMigration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS mission_budgets \(/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mission_budgets_budget_date/);
  });

  it("chaque colonne et chaque contrainte Drizzle existe dans le SQL, sous le même nom", () => {
    // destination_id et sa FK sont ajoutées par la migration du barème (L1b), la FK trésorerie par L1c.
    const sql = fromMigration() + "\n" + norm(readFileSync("server/db/migrations/20261105_mission_destinations.sql", "utf8"))
      .replace(/ADD COLUMN IF NOT EXISTS destination_id/, "\n  destination_id")
      + "\n" + norm(readFileSync("server/db/migrations/20261105_mission_budgets_treasury.sql", "utf8"))
      // settled_by / settled_at et leur FK : migration de la mission soldée (Q18).
      + "\n" + norm(readFileSync("server/db/migrations/20261106_mission_budget_settlement.sql", "utf8"))
        .replace(/ADD COLUMN (settled_\w+)/g, "\n  $1");
    const config = getTableConfig(missionBudgets);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\\n  ${column.name} `));
    const names = [
      ...config.checks.map((c) => c.name),
      ...config.foreignKeys.map((fk) => fk.getName()),
      "mission_budgets_mission_id_unique",
    ];
    for (const name of names) expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
  });

  it("colonnes d'audit présentes, lien trésorerie nullable (FK posée par la migration L1c)", () => {
    const sql = fromMigration();
    for (const col of ["created_by", "updated_by", "created_at", "updated_at"]) expect(sql).toContain(`  ${col} `);
    expect(sql).toMatch(/\n  treasury_entry_id integer,\n/);
  });

  // Un CHECK écrit seulement dans CREATE TABLE IF NOT EXISTS n'est jamais posé sur une base poussée par
  // drizzle-kit, et un push --force le retire : chaque contrainte est déclarée dans Drizzle, posée sous le
  // même nom par le SQL (création et réconciliation) et relue par reportCdcConstraintGaps.
  it("contraintes : mêmes noms dans Drizzle, dans le SQL et dans CDC_RECONCILED_CONSTRAINTS", () => {
    const config = getTableConfig(missionBudgets);
    const unique = config.columns.filter((c) => c.isUnique).flatMap((c) => (c.uniqueName ? [c.uniqueName] : []));
    const declared = [...config.checks.map((c) => c.name), ...unique].sort();
    expect(declared).toEqual(["mission_budgets_amounts_check", "mission_budgets_mission_id_unique", "mission_budgets_status_check"]);
    const sql = fromMigration();
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    const reconciled = src.slice(listStart, src.indexOf("];", listStart));
    for (const name of declared) {
      expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
      expect(reconciled, name).toContain(`'${name}'`);
    }
    for (const name of declared.filter((n) => n.endsWith("_check"))) {
      expect(sql, name).toContain(`('${name}', 'CHECK (`);
    }
    expect(sql).toContain("ADD CONSTRAINT %I %s NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT %I");
    expect(sql).toContain("ADD CONSTRAINT mission_budgets_mission_id_unique UNIQUE (mission_id)");
  });

  it("l'écart de contraintes est relu après la création de mission_budgets, pas avant", () => {
    const src = norm(readFileSync("server/init-database.ts", "utf8"));
    expect(src).toMatch(/await pool\.query\(MISSION_BUDGETS_SQL\);\n(\s*(\/\/.*|await pool\.query\(MISSION_(DESTINATIONS|BUDGETS_TREASURY|BUDGET_EXPENSES|BUDGET_SETTLEMENT)_SQL\);)\n)*\s*await reportCdcConstraintGaps\(pool\);/);
    expect(src).not.toMatch(/async function applyCdcSchema\(\) \{[^}]*reportCdcConstraintGaps/);
  });
});

describe("L1b : barème mission_destinations, init-database, migration jumelle et Drizzle", () => {
  const MIGRATION = "server/db/migrations/20261105_mission_destinations.sql";
  const migration = () =>
    norm(norm(readFileSync(MIGRATION, "utf8")).split("\n").filter((line) => !line.startsWith("--")).join("\n"));
  const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));
  const initSql = () => {
    const src = initSource();
    const marker = "export const MISSION_DESTINATIONS_SQL = `";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
  };

  it("init-database porte exactement le SQL de la migration, appliqué après celui des budgets", () => {
    expect(initSql()).toBe(migration());
    expect(initSource()).toMatch(/await pool\.query\(MISSION_BUDGETS_SQL\);\n(\s*\/\/.*\n)*\s*await pool\.query\(MISSION_DESTINATIONS_SQL\);\n(\s*(\/\/.*|await pool\.query\(MISSION_(BUDGETS_TREASURY|BUDGET_EXPENSES|BUDGET_SETTLEMENT)_SQL\);)\n)*\s*await reportCdcConstraintGaps\(pool\);/);
  });

  it("additif et idempotent : seed sans réécriture, aucune suppression", () => {
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    // Verrou de table borné : un démarrage ne reste pas bloqué derrière une transaction longue.
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mission_destinations");
    expect(sql).toContain("ON CONFLICT (code) DO NOTHING");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS destination_id integer");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
    // L'unicité du code est réconciliée avant le seed, qui en dépend (ON CONFLICT).
    expect(sql.indexOf("mission_destinations_code_unique UNIQUE (code);")).toBeLessThan(sql.indexOf("INSERT INTO mission_destinations"));
  });

  it("seed limité aux cinq destinations relevées", () => {
    const codes = [...migration().matchAll(/^\s+\('([a-z]+)', '/gm)].map((m) => m[1]);
    expect(codes).toEqual(["ndjamena", "kome", "sarh", "ngong", "douala"]);
  });

  it("colonnes et contraintes : mêmes noms dans Drizzle, dans le SQL et dans CDC_RECONCILED_CONSTRAINTS", () => {
    const sql = migration();
    const config = getTableConfig(missionDestinations);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\n  ${column.name} `));
    const declared = [
      ...config.checks.map((c) => c.name),
      ...config.columns.filter((c) => c.isUnique).map((c) => c.uniqueName),
    ].sort();
    expect(declared).toEqual(["mission_destinations_amounts_check", "mission_destinations_code_unique"]);
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    const reconciled = src.slice(listStart, src.indexOf("];", listStart));
    for (const name of declared) {
      expect(sql, name).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
      expect(reconciled, name).toContain(`'${name}'`);
    }
    expect(sql).toContain("NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT mission_destinations_amounts_check");
    const fk = getTableConfig(missionBudgets).foreignKeys.map((k) => k.getName());
    expect(fk).toContain("mission_budgets_destination_id_mission_destinations_id_fk");
    expect(sql).toContain("CONSTRAINT mission_budgets_destination_id_mission_destinations_id_fk");
    // Orphelins possibles sur une base existante : NOT VALID, VALIDATE en repli WARNING, relue au démarrage.
    expect(sql).toContain("REFERENCES mission_destinations(id) NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT mission_budgets_destination_id_mission_destinations_id_fk");
    expect(sql).toContain("EXCEPTION WHEN foreign_key_violation");
    expect(reconciled).toContain("'mission_budgets_destination_id_mission_destinations_id_fk'");
  });
});

describe("L1c : FK trésorerie de mission_budgets, init-database et migration jumelle", () => {
  const MIGRATION = "server/db/migrations/20261105_mission_budgets_treasury.sql";
  const FK = "mission_budgets_treasury_entry_id_treasury_entries_id_fk";
  const migration = () =>
    norm(norm(readFileSync(MIGRATION, "utf8")).split("\n").filter((line) => !line.startsWith("--")).join("\n"));
  const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));

  it("init-database porte exactement le SQL de la migration, appliqué après le barème et avant le relevé", () => {
    const src = initSource();
    const marker = "export const MISSION_BUDGETS_TREASURY_SQL = `";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    expect(norm(src.slice(start + marker.length, src.indexOf("`;", start)))).toBe(migration());
    expect(src).toMatch(/await pool\.query\(MISSION_DESTINATIONS_SQL\);\n(\s*\/\/.*\n)*\s*await pool\.query\(MISSION_BUDGETS_TREASURY_SQL\);\n(\s*(\/\/.*|await pool\.query\(MISSION_BUDGET_(EXPENSES|SETTLEMENT)_SQL\);)\n)*\s*await reportCdcConstraintGaps\(pool\);/);
  });

  it("les fichiers de migration passent par ordre alphabétique : celui-ci après la création de mission_budgets", () => {
    expect(["20261105_mission_budgets_treasury.sql", "20261105_mission_budgets.sql"].sort()[0]).toBe("20261105_mission_budgets.sql");
  });

  it("Drizzle déclare la FK sous le nom posé, NOT VALID puis VALIDATE avec repli, relue au démarrage", () => {
    expect(getTableConfig(missionBudgets).foreignKeys.map((k) => k.getName())).toContain(FK);
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    // Verrou de table borné : un démarrage ne reste pas bloqué derrière une transaction longue.
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("to_regclass('treasury_entries') IS NULL");
    expect(sql).toContain(`CONSTRAINT ${FK}\n      FOREIGN KEY (treasury_entry_id) REFERENCES treasury_entries(id) NOT VALID`);
    expect(sql).toContain(`VALIDATE CONSTRAINT ${FK}`);
    expect(sql).toContain("EXCEPTION WHEN foreign_key_violation");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    expect(src.slice(listStart, src.indexOf("];", listStart))).toContain(`'${FK}'`);
  });
});

describe("L1e : dépenses justifiées mission_budget_expenses, init-database, migration jumelle et Drizzle", () => {
  const MIGRATION = "server/db/migrations/20261106_mission_budget_expenses.sql";
  const CHECKS = ["mission_budget_expenses_line_check", "mission_budget_expenses_amount_check"];
  const migration = () =>
    norm(norm(readFileSync(MIGRATION, "utf8")).split("\n").filter((line) => !line.startsWith("--")).join("\n"));
  const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));

  it("init-database porte exactement le SQL de la migration, appliqué après le lien trésorerie et avant le relevé", () => {
    const src = initSource();
    const marker = "export const MISSION_BUDGET_EXPENSES_SQL = `";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    expect(norm(src.slice(start + marker.length, src.indexOf("`;", start)))).toBe(migration());
    expect(src).toMatch(/await pool\.query\(MISSION_BUDGETS_TREASURY_SQL\);\n(\s*\/\/.*\n)*\s*await pool\.query\(MISSION_BUDGET_EXPENSES_SQL\);\n(\s*(\/\/.*|await pool\.query\(MISSION_BUDGET_SETTLEMENT_SQL\);)\n)*\s*await reportCdcConstraintGaps\(pool\);/);
  });

  it("les fichiers de migration passent par ordre alphabétique : celui-ci après la création de mission_budgets", () => {
    expect(["20261106_mission_budget_expenses.sql", "20261105_mission_budgets.sql"].sort()[0]).toBe("20261105_mission_budgets.sql");
  });

  it("Drizzle et SQL déclarent les mêmes colonnes, CHECK, FK et index, sous les mêmes noms", () => {
    const sql = migration();
    const config = getTableConfig(missionBudgetExpenses);
    for (const column of config.columns) expect(sql, column.name).toMatch(new RegExp(`\\n  ${column.name} `));
    for (const name of CHECKS) {
      expect(config.checks.map((c) => c.name)).toContain(name);
      expect(sql).toMatch(new RegExp(`CONSTRAINT ${name}\\s`));
      expect(sql).toContain(`('${name}', 'CHECK (`);
    }
    for (const fk of config.foreignKeys.map((k) => k.getName())) expect(sql).toContain(`CONSTRAINT ${fk} REFERENCES`);
    expect(config.foreignKeys).toHaveLength(4);
    expect(config.indexes.map((i) => i.config.name)).toEqual(["idx_mission_budget_expenses_budget_id"]);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_mission_budget_expenses_budget_id ON mission_budget_expenses (budget_id);");
  });

  it("additif, idempotent, verrou borné ; CHECK réconciliés et relus au démarrage ; aucune suppression physique", () => {
    const sql = migration();
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mission_budget_expenses (");
    expect(sql).toContain("ADD CONSTRAINT %I %s NOT VALID");
    expect(sql).toContain("VALIDATE CONSTRAINT %I");
    expect(sql).toContain("EXCEPTION WHEN check_violation");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE /);
    // Suppression douce : la colonne existe, aucune cascade ne l'efface avec son budget.
    expect(sql).toContain("\n  deleted_at timestamp,");
    expect(sql).not.toMatch(/ON DELETE CASCADE/i);
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    for (const name of CHECKS) expect(src.slice(listStart, src.indexOf("];", listStart))).toContain(`'${name}'`);
  });

  it("les 4 FK, posées à la création seulement, sont relues au démarrage sous leur nom Drizzle", () => {
    const fks = getTableConfig(missionBudgetExpenses).foreignKeys.map((k) => k.getName());
    expect(fks).toHaveLength(4);
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    for (const fk of fks) expect(src.slice(listStart, src.indexOf("];", listStart)), fk).toContain(`'${fk}'`);
  });
});

describe("Q18 : mission soldée (settled_by, settled_at), init-database, migration jumelle et Drizzle", () => {
  const MIGRATION = "server/db/migrations/20261106_mission_budget_settlement.sql";
  const FK = "mission_budgets_settled_by_users_id_fk";
  const migration = () =>
    norm(norm(readFileSync(MIGRATION, "utf8")).split("\n").filter((line) => !line.startsWith("--")).join("\n"));
  const initSource = () => norm(readFileSync("server/init-database.ts", "utf8"));

  it("init-database porte exactement le SQL de la migration, appliqué après les dépenses et avant le relevé", () => {
    const src = initSource();
    const marker = "export const MISSION_BUDGET_SETTLEMENT_SQL = `";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    expect(norm(src.slice(start + marker.length, src.indexOf("`;", start)))).toBe(migration());
    expect(src).toMatch(/await pool\.query\(MISSION_BUDGET_EXPENSES_SQL\);\n(\s*\/\/.*\n)*\s*await pool\.query\(MISSION_BUDGET_SETTLEMENT_SQL\);\n(\s*\/\/.*\n)*\s*await reportCdcConstraintGaps\(pool\);/);
  });

  it("les fichiers de migration passent par ordre alphabétique : celui-ci après les dépenses", () => {
    const files = ["20261106_mission_budget_settlement.sql", "20261106_mission_budget_expenses.sql", "20261105_mission_budgets.sql"].sort();
    expect(files[files.length - 1]).toBe("20261106_mission_budget_settlement.sql");
  });

  it("colonnes nullables sans rétro-remplissage, testées avant ALTER, verrou borné", () => {
    const sql = migration();
    const config = getTableConfig(missionBudgets);
    for (const name of ["settled_by", "settled_at"]) {
      const column = config.columns.find((c) => c.name === name);
      expect(column, name).toBeDefined();
      expect(column!.notNull, name).toBe(false);
      expect(column!.hasDefault, name).toBe(false);
      expect(sql).toContain(`column_name = '${name}'`);
    }
    expect(sql).toContain("ALTER TABLE mission_budgets ADD COLUMN settled_by integer;");
    expect(sql).toContain("ALTER TABLE mission_budgets ADD COLUMN settled_at timestamp;");
    expect(sql.startsWith("SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));")).toBe(true);
    expect(sql).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql).toContain("EXCEPTION WHEN lock_not_available");
    expect(sql).not.toMatch(/DELETE |UPDATE |DROP |TRUNCATE |SET DEFAULT|NOT NULL;/);
  });

  it("FK posée NOT VALID puis validée avec repli, sous le nom Drizzle, relue au démarrage", () => {
    const sql = migration();
    expect(getTableConfig(missionBudgets).foreignKeys.map((k) => k.getName())).toContain(FK);
    expect(sql).toContain(`ADD CONSTRAINT ${FK}\n      FOREIGN KEY (settled_by) REFERENCES users(id) NOT VALID;`);
    expect(sql).toContain(`VALIDATE CONSTRAINT ${FK};`);
    expect(sql).toContain("EXCEPTION WHEN foreign_key_violation");
    const src = initSource();
    const listStart = src.indexOf("export const CDC_RECONCILED_CONSTRAINTS");
    expect(src.slice(listStart, src.indexOf("];", listStart))).toContain(`'${FK}'`);
  });
});
