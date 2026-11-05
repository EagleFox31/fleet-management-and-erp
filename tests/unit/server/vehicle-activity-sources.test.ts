import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  VEHICLE_ACTIVITY_SOURCES,
  VEHICLE_DEACTIVATIONS,
  VEHICLE_REFERENCES_NOT_ACTIVITY,
} from "../../../server/services/vehicle-lifecycle-sources";

/**
 * Le critère « le véhicule a eu une action » est une liste explicite. Une clé étrangère vers
 * `vehicles.id` ajoutée sans y être classée laisserait la suppression physique effacer (cascade)
 * ou bloquer (23503) des données saisies : ce garde l'impose au moment où la colonne est créée.
 */

const ROOT = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sqlFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return sqlFiles(rel);
    return name.endsWith(".sql") ? [rel] : [];
  });
}

/** `table.column` de chaque clé étrangère vers `vehicles.id` dans le schéma Drizzle. */
function drizzleReferences(source: string): string[] {
  const found: string[] = [];
  let table = "";
  for (const line of source.split(/\r?\n/)) {
    const t = line.match(/pgTable\(\s*["'](\w+)["']/);
    if (t) table = t[1];
    const c = line.match(/\(\s*["'](\w+)["']\s*\)[^\n]*references\(\s*\(\)\s*=>\s*vehicles\.id\b/);
    if (c) found.push(`${table}.${c[1]}`);
  }
  return found;
}

/** Même relevé dans le SQL (`CREATE TABLE` / `ALTER TABLE ... ADD COLUMN`). */
function sqlReferences(source: string): string[] {
  const found: string[] = [];
  let table = "";
  for (const line of source.split(/\r?\n/)) {
    const t = line.match(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: IF EXISTS)?)\s+"?(\w+)"?/i);
    if (t) table = t[1];
    const c = line.match(/(?:ADD COLUMN(?: IF NOT EXISTS)?\s+)?"?(\w+)"?\s+integer\b[^\n]*REFERENCES\s+"?vehicles"?\s*\(\s*"?id"?\s*\)/i);
    if (c) found.push(`${table}.${c[1]}`);
  }
  return found;
}

const classified = new Set([
  ...VEHICLE_ACTIVITY_SOURCES.map((s) => `${s.table}.${s.column}`),
  ...Object.keys(VEHICLE_REFERENCES_NOT_ACTIVITY),
]);

describe("critère d'action d'un véhicule : toute référence à vehicles.id est classée", () => {
  const references = new Set([
    ...drizzleReferences(read("shared/schema.ts")),
    ...sqlReferences(read("server/init-database.ts")),
    ...sqlFiles("server/db").flatMap((file) => sqlReferences(read(file))),
  ]);

  it("le relevé trouve bien les références connues (le scan n'est pas aveugle)", () => {
    expect(references.has("work_orders.vehicle_id")).toBe(true);
    expect(references.has("mission_operations.trailer_vehicle_id")).toBe(true);
    expect(references.has("vehicle_deletion_effects.vehicle_id")).toBe(true);
  });

  it("chaque clé étrangère vers vehicles.id est une source d'action ou une exception motivée", () => {
    const unclassified = [...references].filter((ref) => !classified.has(ref)).sort();
    expect(unclassified).toEqual([]);
  });

  it("aucune entrée classée ne vise une colonne disparue", () => {
    const stale = [...classified].filter((ref) => !references.has(ref)).sort();
    expect(stale).toEqual([]);
  });

  it("une table désactivée par la suppression douce est aussi une source d'action", () => {
    const sources = new Set(VEHICLE_ACTIVITY_SOURCES.map((s) => s.table));
    expect(VEHICLE_DEACTIVATIONS.filter((d) => !sources.has(d.table))).toEqual([]);
  });

  it("le relevé SQL lit CREATE TABLE et ALTER TABLE ADD COLUMN", () => {
    const sample = [
      "CREATE TABLE IF NOT EXISTS foo (",
      "  vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,",
      ");",
      "ALTER TABLE bar ADD COLUMN IF NOT EXISTS truck_id integer REFERENCES vehicles (id);",
    ].join("\n");
    expect(sqlReferences(sample)).toEqual(["foo.vehicle_id", "bar.truck_id"]);
  });
});
