import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  insertVehicleSchema,
  VEHICLE_TANK_CAPACITY_MAX_L,
  VEHICLE_TANK_CAPACITY_MESSAGE,
  vehicleTankCapacitySchema,
} from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();

function fromMigration(): string {
  return norm(
    norm(readFileSync("server/db/migrations/20261102_vehicles_tank_capacity.sql", "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n"),
  );
}

// Lu comme texte : importer init-database.ts ouvrirait le pool de connexions (unitaires sans base).
function fromInitDatabase(): string {
  const src = norm(readFileSync("server/init-database.ts", "utf8"));
  const marker = "export const VEHICLE_TANK_CAPACITY_SQL = `";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return norm(src.slice(start + marker.length, src.indexOf("`;", start)));
}

describe("FUEL3 : capacité des réservoirs, init-database et migration jumelle", () => {
  it("init-database porte exactement le SQL de la migration", () => {
    expect(fromInitDatabase()).toBe(fromMigration());
  });

  it("colonne nullable ajoutée avec IF NOT EXISTS et contrainte posée seulement si absente", () => {
    const sql = fromMigration().replace(/\s+/g, " ");
    expect(sql).toMatch(/ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_capacity_l real;/);
    expect(sql).toMatch(/IF NOT EXISTS \( SELECT 1 FROM pg_constraint/);
    expect(sql).toMatch(/CHECK \(tank_capacity_l IS NULL OR \(tank_capacity_l > 0 AND/);
  });

  it("init-database applique le SQL au démarrage", () => {
    expect(readFileSync("server/init-database.ts", "utf8")).toMatch(/await pool\.query\(VEHICLE_TANK_CAPACITY_SQL\)/);
  });
});

describe("FUEL3 : saisie de la capacité (Zod)", () => {
  const base = { registrationNumber: "TEST-FUEL3", brand: "Volvo", model: "FH", year: 2020, mileage: 0 };

  it("champ facultatif : un véhicule sans capacité reste valide (contrat inchangé)", () => {
    const parsed = insertVehicleSchema.parse(base);
    expect(parsed.tankCapacityL).toBeUndefined();
  });

  it.each([
    [400, 400],
    ["650.5", 650.5],
    [1, 1],
    [VEHICLE_TANK_CAPACITY_MAX_L, VEHICLE_TANK_CAPACITY_MAX_L],
    [null, null],
    ["", null],
    ["  ", null],
  ])("accepte %j -> %j", (input, expected) => {
    expect(vehicleTankCapacitySchema.parse(input)).toBe(expected);
    expect(insertVehicleSchema.parse({ ...base, tankCapacityL: input }).tankCapacityL).toBe(expected);
  });

  // NaN ne voyage pas en JSON ; Zod le refuse dès le type nombre, avec son message générique.
  it("refuse NaN", () => {
    expect(insertVehicleSchema.safeParse({ ...base, tankCapacityL: Number.NaN }).success).toBe(false);
  });

  it.each([[0], [-10], [0.5], [VEHICLE_TANK_CAPACITY_MAX_L + 1], ["abc"], ["NaN"], [Number.POSITIVE_INFINITY]])(
    "refuse %j avec un message actionnable",
    (input) => {
      const result = insertVehicleSchema.safeParse({ ...base, tankCapacityL: input });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path[0] === "tankCapacityL");
        expect(issue?.message).toBe(VEHICLE_TANK_CAPACITY_MESSAGE);
      }
    },
  );
});
