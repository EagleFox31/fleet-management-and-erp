import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * #240, garde-fou d'hygiène : écriture d'une affectation de mission.
 *
 * `assignments` n'a pas d'unicité sur `mission_id` : une mission porte N affectations.
 * Une écriture qui ne filtre que sur l'id lu un instant plus tôt (ou sur la mission) peut
 * ressusciter une ligne annulée ou refusée (elle reprend sa part du CA et ses droits de saisie),
 * ou écrire sur la ligne d'un autre chauffeur. Toute écriture `update(assignments)` /
 * `delete(assignments)` doit donc filtrer aussi sur le statut lu (`assignments.status`) ou sur
 * le chauffeur (`assignments.driverId`).
 *
 * Le test scanne `server/` (hors `_archive` et variantes mortes), retrouve chaque écriture même
 * coupée sur plusieurs lignes, et lit le `.where(...)` qui la suit, parenthèses équilibrées.
 * Une SQL brute `UPDATE assignments` est refusée : elle échappe au scan.
 */

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const DEAD_CODE = /(^|\/)_archive\/|vehicle-(activation|deletion)-service-/;

/** Écritures sur `assignments` sans filtre de statut ni de chauffeur, gelées : liste à vider, jamais à remplir. */
const FROZEN_UNFILTERED: Record<string, number> = {};

const WRITE = /\.\s*(update|delete)\s*\(\s*assignments\s*\)/g;
const RAW_SQL_WRITE = /\b(update|delete\s+from)\s+"?assignments"?\b/gi;
const SCOPE_FILTER = /assignments\s*\.\s*(status|driverId)\b/;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Le texte de `.where(...)` qui suit une écriture, ou `null` si l'instruction n'en a pas. */
export function whereClauseAfter(source: string, from: number): string | null {
  const end = source.indexOf(";", from);
  const statement = source.slice(from, end === -1 ? undefined : end);
  const at = statement.search(/\.\s*where\s*\(/);
  if (at === -1) return null;
  const open = statement.indexOf("(", at);
  let depth = 0;
  for (let i = open; i < statement.length; i += 1) {
    if (statement[i] === "(") depth += 1;
    if (statement[i] === ")") depth -= 1;
    if (depth === 0) return statement.slice(open, i + 1);
  }
  return statement.slice(open);
}

export function unfilteredWritesIn(source: string): number {
  let count = 0;
  for (const match of source.matchAll(WRITE)) {
    const where = whereClauseAfter(source, match.index! + match[0].length);
    if (where === null || !SCOPE_FILTER.test(where)) count += 1;
  }
  return count;
}

/**
 * Lecture filtrée par chauffeur : `eq(assignments.driverId, x)` ou `inArray(assignments.driverId, …)`
 * seul garde visible la mission d'un chauffeur retiré (affectation annulée ou refusée), ou compte
 * cette ligne morte comme un conflit. Chaque filtre sur le chauffeur doit donc vivre dans un
 * `.where(...)` qui filtre aussi `assignments.status`, ou passer par `driverLiveAssignmentFilter`
 * (server/lib/driver-scope.ts, seul endroit où le filtre nu est écrit). La jointure
 * `eq(assignments.driverId, drivers.id)` n'est pas un filtre.
 */
const DRIVER_FILTER = /\b(eq|inArray)\(\s*assignments\s*\.\s*driverId\b(?!\s*,\s*drivers\s*\.\s*id\s*\))/g;
const STATUS_FILTER = /assignments\s*\.\s*status\b/;
const HELPER = /export function driverLiveAssignmentFilter\([^)]*\)\s*\{[^}]*\}/;

/** Le `.where(...)` qui contient la position `at`, ou `null`. */
export function enclosingWhere(source: string, at: number): string | null {
  for (let from = source.lastIndexOf(".where(", at); from !== -1; from = source.lastIndexOf(".where(", from - 1)) {
    const open = source.indexOf("(", from);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      if (source[i] === ")") depth -= 1;
      if (depth === 0) {
        if (i > at) return source.slice(open, i + 1);
        break;
      }
    }
  }
  return null;
}

export function driverFiltersWithoutStatus(source: string): number {
  const helper = HELPER.exec(source);
  let count = 0;
  for (const match of source.matchAll(DRIVER_FILTER)) {
    const at = match.index!;
    if (helper && at >= helper.index && at < helper.index + helper[0].length) continue;
    const where = enclosingWhere(source, at);
    if (where === null || !STATUS_FILTER.test(where)) count += 1;
  }
  return count;
}

function scan() {
  const unfiltered: Record<string, number> = {};
  const rawSql: string[] = [];
  const driverWithoutStatus: Record<string, number> = {};
  for (const path of tsFiles(serverDir)) {
    const rel = relative(join(serverDir, ".."), path).split(sep).join("/");
    if (DEAD_CODE.test(rel)) continue;
    const source = readFileSync(path, "utf8");
    const n = unfilteredWritesIn(source);
    if (n > 0) unfiltered[rel] = n;
    if (RAW_SQL_WRITE.test(source)) rawSql.push(rel);
    RAW_SQL_WRITE.lastIndex = 0;
    const d = driverFiltersWithoutStatus(source);
    if (d > 0) driverWithoutStatus[rel] = d;
  }
  return { unfiltered, rawSql, driverWithoutStatus };
}

describe("écritures sur assignments : filtre de statut ou de chauffeur", () => {
  it("aucune écriture hors liste gelée sans filtre sur assignments.status ou assignments.driverId", () => {
    expect(scan().unfiltered).toEqual(FROZEN_UNFILTERED);
  });

  it("aucune SQL brute UPDATE/DELETE assignments", () => {
    expect(scan().rawSql).toEqual([]);
  });

  it("cloison chauffeur : tout filtre sur assignments.driverId filtre aussi le statut (ou passe par driverLiveAssignmentFilter)", () => {
    expect(scan().driverWithoutStatus).toEqual({});
  });

  it("driverLiveAssignmentFilter écarte les affectations annulées ou refusées", () => {
    const source = readFileSync(join(serverDir, "lib", "driver-scope.ts"), "utf8");
    const body = source.slice(source.indexOf("export function driverLiveAssignmentFilter"));
    expect(body.slice(0, body.indexOf("\n}"))).toMatch(/notInArray\(\s*assignments\.status\s*,\s*\[\.\.\.VOID_ASSIGNMENT_STATUSES\]/);
  });
});

describe("scanner : faux verts connus", () => {
  it("filtre sur l'id seul : refusé", () => {
    expect(unfilteredWritesIn(`await tx.update(assignments).set({ status: "x" }).where(eq(assignments.id, id));`)).toBe(1);
  });

  it("écriture coupée sur plusieurs lignes : vue", () => {
    expect(unfilteredWritesIn(`await db\n  .delete(assignments)\n  .where(eq(assignments.missionId, m));`)).toBe(1);
  });

  it("sans where : refusé", () => {
    expect(unfilteredWritesIn(`await db.update(assignments).set({ status: "x" });`)).toBe(1);
  });

  it("le filtre d'une autre instruction ne compte pas", () => {
    expect(
      unfilteredWritesIn(`await db.update(assignments).set({ a: 1 });\nawait db.select().from(assignments).where(eq(assignments.status, "x"));`),
    ).toBe(1);
  });

  it("filtre sur le statut lu ou sur le chauffeur : accepté", () => {
    expect(
      unfilteredWritesIn(
        `await tx\n  .update(assignments)\n  .set({ status: "cancelled" })\n  .where(and(eq(assignments.id, id), eq(assignments.status, read.status)));\n` +
          `await db.update(assignments).set({ a: 1 }).where(and(eq(assignments.id, id), eq(assignments.driverId, d)));`,
      ),
    ).toBe(0);
  });
  it("lecture filtrée sur le chauffeur sans statut : refusée ; avec statut, jointure ou helper : acceptée", () => {
    expect(driverFiltersWithoutStatus(`db.select().from(assignments).where(eq(assignments.driverId, driver.id)).orderBy(x);`)).toBe(1);
    expect(driverFiltersWithoutStatus(`q.where(and(ne(a, b), or(eq(assignments.vehicleId, v), eq(assignments.driverId, d))));`)).toBe(1);
    expect(driverFiltersWithoutStatus(`q.where(and(inArray(assignments.driverId, s), notInArray(assignments.status, [...V])));`)).toBe(0);
    expect(driverFiltersWithoutStatus(`q.innerJoin(drivers, eq(assignments.driverId, drivers.id)).where(eq(missions.id, 1));`)).toBe(0);
    expect(driverFiltersWithoutStatus(`q.where(driverLiveAssignmentFilter([driver.id]));`)).toBe(0);
  });
});
