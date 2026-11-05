import { readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID, parseQueryId, queryIdOrNaN } from "../../../server/lib/route-id";
import { countBoundRequestConversions, looseNumericValue, requestFieldName, unwrapValue } from "../../support/request-id-scan";
import { sourceFiles, stripComments } from "../../support/route-guard-scan";

/**
 * Identifiant de filtre lu dans `req.query` : une seule lecture, `parseQueryId` (`server/lib/route-id.ts`),
 * ou `queryIdOrNaN` dans `server/routes.ts` (gelé). Absent ou vide : pas de filtre ; sinon chiffres seuls, 400.
 *
 * `parseInt("12abc")` vaut 12 : la liste est filtrée sur un autre objet que celui demandé ; `NaN`
 * (`?vehicleId=abc`) fait ignorer le filtre ou répondre 500, et un id au-delà de l'int4 fait répondre 500.
 *
 * Cliquet sur `server/api` et `server/routes.ts` : une conversion lâche (`parseInt`, `parseFloat`, `Number`,
 * `Number.parseInt`, `Number.parseFloat`, `+` unaire, avec ou sans `String(…)`) d'un paramètre de requête
 * dont le nom désigne un id (`id`, `…Id`, `…edBy`), lu directement (`parseInt(req.query.vehicleId)`) ou par
 * une variable rattachée à sa déclaration (`const { clientId } = req.query; parseInt(clientId)`,
 * `tests/support/request-id-scan.ts`). La requête est `req` ou le premier paramètre du handler.
 * `year`, `month`, `limit`, `sortBy`, `groupBy` ne sont pas des ids.
 * Limites : un nom d'id hors motif (`owner`, `client`, `by`) n'est pas vu, ni une conversion par `Math.*`,
 * `~~x`, `x | 0` ou un parseur maison.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const API_DIR = join(ROOT, "server/api");
/** `id`, `vehicleId`, `createdBy`… ; pas `sortBy`, `groupBy`, `orderBy` (pas de participe en `-ed`). */
const ID_NAME = /^(?:id|\w*Id|\w+edBy)$/;

/** Relevé du 5 novembre 2026 après le lot 11 : vide. Ne peut que rétrécir. */
const FROZEN: Record<string, number> = {};
const ROUTES_TS_FROZEN = 0;

/** Conversion lâche d'un id de filtre lu directement : `parseInt(req.query.vehicleId)`, `+req.query["createdBy"]`. */
function countDirect(sf: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    const value = looseNumericValue(node);
    const field = value ? requestFieldName(unwrapValue(value), "query") : null;
    if (field !== null && ID_NAME.test(field)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

export function countLooseQueryIdReads(source: string): number {
  const clean = stripComments(source);
  const direct = countDirect(ts.createSourceFile("f.ts", clean, ts.ScriptTarget.Latest, true));
  return direct + countBoundRequestConversions("f.ts", clean, "query", (name) => ID_NAME.test(name), looseNumericValue);
}

function actualCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(API_DIR)) {
    const n = countLooseQueryIdReads(readFileSync(file, "utf8"));
    if (n > 0) counts[relative(API_DIR, file).replace(/\\/g, "/")] = n;
  }
  return counts;
}

describe("ids de filtre (req.query) : parseQueryId, cliquet sur les lectures lâches", () => {
  it("server/api : aucune lecture lâche d'un id de filtre", () => {
    expect(actualCounts()).toEqual(FROZEN);
  });

  it("server/routes.ts (gelé) : aucune lecture lâche d'un id de filtre", () => {
    expect(countLooseQueryIdReads(readFileSync(join(ROOT, "server/routes.ts"), "utf8"))).toBe(ROUTES_TS_FROZEN);
  });

  it("queryIdOrNaN reste cantonné à server/routes.ts (les routeurs neufs lèvent par parseQueryId)", () => {
    const users = sourceFiles(join(ROOT, "server"))
      .filter((file) => /\bqueryIdOrNaN\b/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
      .sort();
    expect(users).toEqual(["server/lib/route-id.ts", "server/routes.ts"]);
  });

  it("le motif voit les formes lâches d'un id, pas les autres filtres ni parseQueryId", () => {
    const handler = (body: string) => `router.get("/", async (req, res) => {\n${body}\n});`;
    expect(countLooseQueryIdReads(handler("const a = req.query.partId ? parseInt(req.query.partId as string) : undefined;"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const a = Number.parseInt(String(req.query.vehicleId), 10);"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const a = Number(req.query[\"createdBy\"]);"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const { clientId, year } = req.query;\nf(parseInt(clientId as string), parseInt(year as string));"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const { supplier: supplierId } = req.query;\nf(parseInt(supplierId as string));"))).toBe(0);
    expect(countLooseQueryIdReads(handler("const { supplierId: s } = req.query;\nf(parseInt(s as string));"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const raw = req.query.vehicleTireId;\nf(Number(raw));"))).toBe(1);
    expect(countLooseQueryIdReads(handler("const limit = parseInt(req.query.limit as string) || 20;"))).toBe(0);
    expect(countLooseQueryIdReads(handler("const { sortBy, groupBy } = req.query;\nf(Number(sortBy), Number(groupBy));"))).toBe(0);
    expect(countLooseQueryIdReads(handler("const a = +req.query.vehicleId;\nconst b = parseFloat(req.query.clientId as string);"))).toBe(2);
    expect(countLooseQueryIdReads("router.get(\"/\", (request, response) => {\nconst { partId } = request.query;\nf(+partId);\n});")).toBe(1);
    expect(countLooseQueryIdReads(handler("const { clientId } = req.query;\nrows.map((clientId) => Number(clientId));"))).toBe(0);
    expect(countLooseQueryIdReads(handler("const a = parseQueryId(req.query.vehicleId, 'm');"))).toBe(0);
    expect(countLooseQueryIdReads("// parseInt(req.query.vehicleId)\nconst a = 1;")).toBe(0);
  });

  it("parseQueryId : absent ou vide = pas de filtre ; sinon chiffres seuls, de 1 à l'int4, sinon 400", () => {
    expect(parseQueryId(undefined, "m")).toBeUndefined();
    expect(parseQueryId("", "m")).toBeUndefined();
    expect(parseQueryId("12", "m")).toBe(12);
    expect(parseQueryId(String(MAX_DB_INTEGER_ID), "m")).toBe(MAX_DB_INTEGER_ID);
    for (const bad of ["12abc", "0", "-1", "1.5", "1e3", " 7", "abc", String(MAX_DB_INTEGER_ID + 1), ["1", "2"], 12]) {
      expect(() => parseQueryId(bad, "ID de véhicule invalide")).toThrowError(
        expect.objectContaining({ status: 400, message: "ID de véhicule invalide" }),
      );
    }
  });

  it("queryIdOrNaN : même lecture que parseQueryId, NaN au lieu de lever", () => {
    expect(queryIdOrNaN(undefined)).toBeUndefined();
    expect(queryIdOrNaN("")).toBeUndefined();
    expect(queryIdOrNaN("12")).toBe(12);
    for (const bad of ["12abc", "0", "abc", String(MAX_DB_INTEGER_ID + 1), ["1", "2"]]) {
      expect(queryIdOrNaN(bad), String(bad)).toBeNaN();
    }
  });
});
