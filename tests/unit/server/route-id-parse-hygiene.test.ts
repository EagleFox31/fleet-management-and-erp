import { existsSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID, parseRouteId, routeIdOrNaN } from "../../../server/lib/route-id";
import { sourceFiles, stripComments } from "../../support/route-guard-scan";

/**
 * Identifiant de route : une seule lecture, `parseRouteId` (`server/lib/route-id.ts`).
 *
 * `parseInt("12abc")` vaut 12 : la route vise alors un autre objet que celui demandé
 * (justificatif de règlement, coûts de mission, 5 novembre 2026). `Number(req.params.x)`
 * accepte `"1e3"`, `" 7 "` ou `"0x1F"`, et un id au-delà de l'int4 fait répondre 500 par Postgres.
 *
 * Cliquet : par fichier de `server/api`, le nombre de lectures lâches ne peut que baisser.
 * Un fichier absent de la liste n'en a aucune. Quand un fichier passe à `parseRouteId`,
 * baisser (ou retirer) son entrée : le test l'exige. Une lecture lâche, c'est :
 * - `parseInt(req.params…`, `Number.parseInt(req.params…`, `Number(req.params…` ;
 * - un appel `f(req.params…)` où `f` est un parseur du fichier ou importé par chemin relatif
 *   (`function f`, `const f = (…) =>`) qui fait `parseInt`, `Number.parseInt` ou `Number(…)`
 *   sans déléguer à `parseRouteId` (`parseDriverId`, 5 novembre 2026 : `"1abc"` lu 1).
 *
 * Limites : une valeur d'abord déstructurée (`const { id } = req.params; parseInt(id)`) n'est
 * pas vue, ni un parseur importé par alias (`@/…`) ou d'un paquet, ni un appel membre
 * (`helpers.parseX(req.params.id)`). Un parseur strict qui ne délègue pas à `parseRouteId`
 * compte comme lâche : le faire déléguer. `server/routes.ts`, gelé, n'est pas couvert.
 * Non vus non plus : un parseur à deux niveaux (`parseWrapped` qui appelle `rawNum`, qui fait
 * `parseInt`) ; un parseur mixte qui appelle aussi `parseRouteId` (`lax ? parseInt(v) : parseRouteId(v)`) ;
 * une conversion dans une fonction déclarée prédicat (`: v is string`, `: boolean`) puis transtypée (`as any`).
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const API_DIR = join(ROOT, "server/api");
const LOOSE_PARAM_READ = /\b(?:Number\.)?parseInt\(\s*req\.params\b|\bNumber\(\s*req\.params\b/g;

/** Occurrences relevées le 5 novembre 2026. Ne peut que rétrécir. */
const FROZEN: Record<string, number> = {
  "admin-users-guard.routes.ts": 1,
  "document-renewals.routes.ts": 1,
  "part-requirements.routes.ts": 3,
  "parts-catalog.routes.ts": 3,
  "supplier-invoices.routes.ts": 5,
  "vehicles.routes.ts": 2,
  "work-order-items.routes.ts": 4,
  "work-order-parts.routes.ts": 5,
};

/** Lectures lâches restantes dans `server/routes.ts` (gelé). Ne peut que baisser. */
const ROUTES_TS_FROZEN = 39;

export function countLooseParamReads(source: string): number {
  return (stripComments(source).match(LOOSE_PARAM_READ) ?? []).length;
}

const STRICT_PARSER = "parseRouteId";

type ReadModule = (path: string) => string | null;

function readTs(path: string): string | null {
  for (const candidate of [path, `${path}.ts`, join(path, "index.ts")]) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return readFileSync(candidate, "utf8");
  }
  return null;
}

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

/** Corps de fonction lâche : une conversion `parseInt` / `Number(…)` et aucun appel à `parseRouteId`. */
function isLooseParserBody(body: ts.Node): boolean {
  let converts = false;
  let delegates = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isLooseConversion(node)) converts = true;
      if (ts.isIdentifier(node.expression) && node.expression.text === STRICT_PARSER) delegates = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return converts && !delegates;
}

/** Un prédicat (`value is string`, `: boolean`) valide un segment, il ne rend pas d'id : pas un parseur. */
function isPredicate(fn: ts.SignatureDeclaration): boolean {
  const type = fn.type;
  return !!type && (ts.isTypePredicateNode(type) || type.kind === ts.SyntaxKind.BooleanKeyword);
}

/** Corps des fonctions déclarées au premier niveau d'un module, par nom (exportées ou non), prédicats exclus. */
function topLevelFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body && !isPredicate(stmt)) found.set(stmt.name.text, stmt.body);
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && !isPredicate(init)) {
          found.set(decl.name.text, init.body);
        }
      }
    }
  }
  return found;
}

/** Noms des parseurs lâches visibles depuis le fichier : locaux, ou importés par chemin relatif. */
function looseParsers(file: string, sf: ts.SourceFile, readModule: ReadModule): Set<string> {
  const loose = new Set<string>();
  for (const [name, body] of topLevelFunctions(sf)) if (isLooseParserBody(body)) loose.add(name);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const named = stmt.importClause?.namedBindings;
    if (!spec.startsWith(".") || !named || !ts.isNamedImports(named)) continue;
    const text = readModule(resolve(dirname(file), spec));
    if (text === null) continue;
    const remote = topLevelFunctions(ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true));
    for (const el of named.elements) {
      const original = (el.propertyName ?? el.name).text;
      // La référence elle-même : sa conversion est la lecture stricte.
      if (original === STRICT_PARSER) continue;
      const body = remote.get(original);
      if (body && isLooseParserBody(body)) loose.add(el.name.text);
    }
  }
  return loose;
}

function readsRouteParam(node: ts.Expression): boolean {
  let base: ts.Expression = node;
  while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
    if (
      ts.isPropertyAccessExpression(base) &&
      base.name.text === "params" &&
      ts.isIdentifier(base.expression) &&
      base.expression.text === "req"
    ) {
      return true;
    }
    base = base.expression;
  }
  return false;
}

/** Appels `f(req.params…)` vers un parseur lâche local ou importé. */
export function countLooseParserCalls(file: string, source: string, readModule: ReadModule = readTs): number {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const loose = looseParsers(file, sf, readModule);
  if (loose.size === 0) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      loose.has(node.expression.text) &&
      node.arguments.some(readsRouteParam)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

function actualCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const n = countLooseParamReads(source) + countLooseParserCalls(file, source);
    if (n > 0) counts[relative(API_DIR, file).replace(/\\/g, "/")] = n;
  }
  return counts;
}

describe("lecture des ids de route : parseRouteId, cliquet sur les lectures lâches de req.params", () => {
  it("aucune lecture lâche nouvelle, et la liste gelée suit les retraits", () => {
    expect(actualCounts()).toEqual(FROZEN);
  });

  it("le motif voit les formes lâches, pas parseRouteId ni un commentaire", () => {
    expect(countLooseParamReads("const a = parseInt(req.params.id);")).toBe(1);
    expect(countLooseParamReads("const a = Number.parseInt(req.params.id, 10);")).toBe(1);
    expect(countLooseParamReads("const a = Number( req.params.assignmentId);")).toBe(1);
    expect(countLooseParamReads("const a = parseRouteId(req.params.id, m);")).toBe(0);
    expect(countLooseParamReads("// parseInt(req.params.id)\nconst a = 1;")).toBe(0);
  });

  it("un parseur local ou importé qui convertit sans parseRouteId est compté à chaque appel", () => {
    const none: ReadModule = () => null;
    const loose = [
      "function parseDriverId(raw: string) { const n = Number.parseInt(raw, 10); return n > 0 ? n : null; }",
      "const parseAlertId = (raw: string) => { const id = Number(raw); return id; };",
      "const parseX = function (raw: string) { return parseInt(raw); };",
    ];
    for (const def of loose) {
      const name = /(?:function |const )(\w+)/.exec(def)![1];
      const src = `${def}\nconst a = ${name}(req.params.id);\nconst b = ${name}(req.params["other"]);\nconst c = ${name}(body.id);`;
      expect(countLooseParserCalls("/x/a.ts", src, none), def).toBe(2);
    }
    const strict = "function parseX(raw: string) { return parseRouteId(raw, 'm'); }\nconst a = parseX(req.params.id);";
    expect(countLooseParserCalls("/x/a.ts", strict, none)).toBe(0);
    const notParser = "function isSeg(raw: string) { return /^\\d+$/.test(raw); }\nconst a = isSeg(req.params.id);";
    expect(countLooseParserCalls("/x/a.ts", notParser, none)).toBe(0);
    const predicate = "function isSeg(v: unknown): v is string { return typeof v === 'string' && Number(v) < 9; }\nconst a = isSeg(req.params.id);";
    expect(countLooseParserCalls("/x/a.ts", predicate, none)).toBe(0);

    const lib = "export function idParam(v: string, l: string) { return Number.parseInt(v, 10); }";
    const readLib: ReadModule = (p) => (p.replace(/\\/g, "/").endsWith("/lib/route-helpers") ? lib : null);
    const importing = 'import { idParam as id } from "../lib/route-helpers";\nconst a = id(req.params.id, "x");';
    expect(countLooseParserCalls("/s/api/a.ts", importing, readLib)).toBe(1);
    const ref = "export function parseRouteId(v: unknown, m: string) { return Number(v); }";
    const importingRef = 'import { parseRouteId } from "../lib/route-id";\nconst a = parseRouteId(req.params.id, "m");';
    expect(countLooseParserCalls("/s/api/a.ts", importingRef, () => ref)).toBe(0);
  });

  it("server/routes.ts (gelé) : le nombre de lectures lâches ne peut que baisser", () => {
    // 50 relevées par ce motif le 5 novembre 2026 (origin/main) ; les 9 DELETE passent à routeIdOrNaN (lot 5).
    expect(countLooseParamReads(readFileSync(join(ROOT, "server/routes.ts"), "utf8"))).toBe(ROUTES_TS_FROZEN);
  });

  it("routeIdOrNaN : même lecture que parseRouteId, NaN au lieu de lever", () => {
    expect(routeIdOrNaN("12")).toBe(12);
    expect(routeIdOrNaN(String(MAX_DB_INTEGER_ID))).toBe(MAX_DB_INTEGER_ID);
    for (const bad of ["12abc", "0", "-1", "1.5", "1e3", " 7", "0x1F", "", String(MAX_DB_INTEGER_ID + 1), undefined, 12]) {
      expect(routeIdOrNaN(bad), String(bad)).toBeNaN();
    }
  });

  it("parseRouteId : chiffres seuls, de 1 à l'int4, sinon 400", () => {
    expect(parseRouteId("12", "m")).toBe(12);
    expect(parseRouteId(String(MAX_DB_INTEGER_ID), "m")).toBe(MAX_DB_INTEGER_ID);
    for (const bad of ["12abc", "0", "-1", "1.5", "1e3", " 7", "0x1F", "", String(MAX_DB_INTEGER_ID + 1), undefined, 12]) {
      expect(() => parseRouteId(bad, "Identifiant invalide.")).toThrowError(
        expect.objectContaining({ status: 400, message: "Identifiant invalide." }),
      );
    }
  });
});
