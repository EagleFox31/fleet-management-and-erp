import { readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID, parseQueryId, queryIdOrNaN } from "../../../server/lib/route-id";
import { sourceFiles, stripComments } from "../../support/route-guard-scan";

/**
 * Identifiant de filtre lu dans `req.query` : une seule lecture, `parseQueryId` (`server/lib/route-id.ts`),
 * ou `queryIdOrNaN` dans `server/routes.ts` (gelé). Absent ou vide : pas de filtre ; sinon chiffres seuls, 400.
 *
 * `parseInt("12abc")` vaut 12 : la liste est filtrée sur un autre objet que celui demandé ; `NaN`
 * (`?vehicleId=abc`) fait ignorer le filtre ou répondre 500, et un id au-delà de l'int4 fait répondre 500.
 *
 * Cliquet sur `server/api` et `server/routes.ts` : une conversion lâche (`parseInt`, `Number.parseInt`,
 * `Number`, avec ou sans `String(…)`) d'un paramètre de requête dont le nom désigne un id
 * (`id`, `…Id`, `…By`), lu directement (`parseInt(req.query.vehicleId)`) ou par une variable
 * (`const { clientId } = req.query; parseInt(clientId)`). `year`, `month`, `limit` ne sont pas des ids.
 * Limite : un nom d'id qui ne suit pas ce motif (`owner`, `client`) n'est pas vu.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const API_DIR = join(ROOT, "server/api");
const ID_NAME = /^(?:id|\w*Id|\w*By)$/;

/** Relevé du 5 novembre 2026 après le lot 11 : vide. Ne peut que rétrécir. */
const FROZEN: Record<string, number> = {};
const ROUTES_TS_FROZEN = 0;

function isLooseConversion(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "parseInt" || callee.text === "Number";
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Number" &&
    callee.name.text === "parseInt"
  );
}

/** Retire `( )`, `as T`, `!` et `String(…)` autour de la valeur convertie. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "String" &&
      current.arguments.length === 1
    ) {
      current = current.arguments[0];
    } else {
      return current;
    }
  }
}

function isReqQuery(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "query" && ts.isIdentifier(node.expression) && node.expression.text === "req";
}

/** `req.query.vehicleId` ou `req.query["vehicleId"]` : le nom lu, sinon `null`. */
function queryFieldName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node) && isReqQuery(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isReqQuery(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** Noms d'id liés par `const { vehicleId, a: supplierId } = req.query` ou `const x = req.query.vehicleId`. */
function idNamesBoundFromQuery(decl: ts.VariableDeclaration): string[] {
  const init = decl.initializer && unwrap(decl.initializer);
  if (!init) return [];
  if (isReqQuery(init) && ts.isObjectBindingPattern(decl.name)) {
    return decl.name.elements.flatMap((el) => {
      const field = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
      return ID_NAME.test(field) && ts.isIdentifier(el.name) ? [el.name.text] : [];
    });
  }
  const field = queryFieldName(init);
  return field !== null && ID_NAME.test(field) && ts.isIdentifier(decl.name) ? [decl.name.text] : [];
}

export function countLooseQueryIdReads(source: string): number {
  const sf = ts.createSourceFile("f.ts", stripComments(source), ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isLooseConversion(node) && node.arguments.length > 0) {
      const field = queryFieldName(unwrap(node.arguments[0]));
      if (field !== null && ID_NAME.test(field)) count += 1;
    }
    if (ts.isVariableDeclaration(node)) {
      const names = new Set(idNamesBoundFromQuery(node));
      const scope = node.parent?.parent?.parent;
      if (names.size > 0 && scope) {
        const countIn = (inner: ts.Node): void => {
          if (ts.isCallExpression(inner) && isLooseConversion(inner) && inner.arguments.length > 0) {
            const arg = unwrap(inner.arguments[0]);
            if (ts.isIdentifier(arg) && names.has(arg.text)) count += 1;
          }
          ts.forEachChild(inner, countIn);
        };
        countIn(scope);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
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
