import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(file: string): string {
  return norm(
    norm(readFileSync(`server/db/migrations/${file}`, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(constant: string): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = `export const ${constant} = \``;
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

const CASES = [
  {
    name: "libération",
    file: "20261102_work_orders_release_vehicle.sql",
    constant: "WORK_ORDER_VEHICLE_RELEASE_SQL",
    fn: "fn_work_orders_release_vehicle",
    trigger: "trg_work_orders_release_vehicle",
    // Hors service n'est jamais levé : seul « maintenance » est libéré.
    onlyFrom: "maintenance",
  },
  {
    name: "ré-immobilisation",
    file: "20261102_work_orders_hold_vehicle.sql",
    constant: "WORK_ORDER_VEHICLE_HOLD_SQL",
    fn: "fn_work_orders_hold_vehicle",
    trigger: "trg_work_orders_hold_vehicle",
    // Hors service n'est jamais repassé en maintenance : seul « operational » est immobilisé.
    onlyFrom: "operational",
  },
] as const;

describe.each(CASES)("trigger de $name du véhicule (AGENTS.md §5)", ({ file, constant, fn, trigger, onlyFrom }) => {
  it("migration et init-database.ts identiques", () => {
    expect(fromInitDatabase(constant)).toBe(fromMigration(file));
  });

  it("reste idempotent et additif", () => {
    const sql = fromMigration(file);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${fn}()`);
    expect(sql).toMatch(new RegExp(`CREATE OR REPLACE TRIGGER ${trigger}\\s+AFTER UPDATE OF status ON work_orders`));
    expect(sql).not.toMatch(/DROP\s+TRIGGER/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION)\b/i);
    expect(sql).toContain(`IF v_status IS DISTINCT FROM '${onlyFrom}' THEN`);
    expect(sql).toContain("deleted_at IS NULL");
  });
});

it("init-database.ts applique les deux triggers", () => {
  const src = readFileSync("server/init-database.ts", "utf8");
  expect(src).toContain("await pool.query(WORK_ORDER_VEHICLE_RELEASE_SQL);");
  expect(src).toContain("await pool.query(WORK_ORDER_VEHICLE_HOLD_SQL);");
});
