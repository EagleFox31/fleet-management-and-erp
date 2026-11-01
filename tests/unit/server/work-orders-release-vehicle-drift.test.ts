import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261102_work_orders_release_vehicle.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const WORK_ORDER_VEHICLE_RELEASE_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("trigger de libération du véhicule : migration et init-database.ts identiques (AGENTS.md §5)", () => {
  it("les deux SQL concordent", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("reste idempotent et additif", () => {
    const sql = fromMigration();
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION fn_work_orders_release_vehicle\(\)/);
    expect(sql).toMatch(/CREATE OR REPLACE TRIGGER trg_work_orders_release_vehicle\s+AFTER UPDATE OF status ON work_orders/);
    expect(sql).not.toMatch(/DROP\s+TRIGGER/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION)\b/i);
    // Hors service n'est jamais levé par le trigger : seul « maintenance » est libéré.
    expect(sql).toMatch(/IF v_status IS DISTINCT FROM 'maintenance' THEN/);
  });
});
