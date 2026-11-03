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

function scan() {
  const unfiltered: Record<string, number> = {};
  const rawSql: string[] = [];
  for (const path of tsFiles(serverDir)) {
    const rel = relative(join(serverDir, ".."), path).split(sep).join("/");
    if (DEAD_CODE.test(rel)) continue;
    const source = readFileSync(path, "utf8");
    const n = unfilteredWritesIn(source);
    if (n > 0) unfiltered[rel] = n;
    if (RAW_SQL_WRITE.test(source)) rawSql.push(rel);
    RAW_SQL_WRITE.lastIndex = 0;
  }
  return { unfiltered, rawSql };
}

describe("écritures sur assignments : filtre de statut ou de chauffeur", () => {
  it("aucune écriture hors liste gelée sans filtre sur assignments.status ou assignments.driverId", () => {
    expect(scan().unfiltered).toEqual(FROZEN_UNFILTERED);
  });

  it("aucune SQL brute UPDATE/DELETE assignments", () => {
    expect(scan().rawSql).toEqual([]);
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
});
