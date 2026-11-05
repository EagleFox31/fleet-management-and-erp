import { existsSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID, parseRouteId, routeIdOrNaN } from "../../../server/lib/route-id";
import { countBoundRequestConversions, isRequestPart, looseNumericValue, unwrapValue } from "../../support/request-id-scan";
import { sourceFiles, stripComments } from "../../support/route-guard-scan";
import { REPO_SCAN_TIMEOUT_MS } from "../../support/repo-files";

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
 * - `parseInt`, `parseFloat`, `Number` (ou `Number.parseInt` / `Number.parseFloat`) et le `+` unaire sur `req.params…`,
 *   avec ou sans `String(…)` ;
 * - un appel `f(req.params…)` où `f` est un parseur du fichier ou importé par chemin relatif
 *   (`function f`, `const f = (…) =>`) qui fait `parseInt`, `Number.parseInt` ou `Number(…)`
 *   sans déléguer à `parseRouteId` (`parseDriverId`, 5 novembre 2026 : `"1abc"` lu 1) ;
 * - la même conversion d'une variable liée depuis `req.params` (`const { id } = req.params; parseInt(id)`),
 *   rattachée à sa déclaration : un nom masqué (`for (const { id } of rows)`) n'est pas compté.
 * La requête est `req` ou le premier paramètre du handler (`(request, res) =>`).
 *
 * Limites : un parseur importé par alias (`@/…`) ou d'un paquet n'est pas vu, ni un appel membre
 * (`helpers.parseX(req.params.id)`). Un parseur strict qui ne délègue pas à `parseRouteId`
 * compte comme lâche : le faire déléguer. `server/routes.ts`, gelé, n'est pas couvert.
 * Non vus non plus : un parseur à deux niveaux (`parseWrapped` qui appelle `rawNum`, qui fait
 * `parseInt`) ; un parseur mixte qui appelle aussi `parseRouteId` (`lax ? parseInt(v) : parseRouteId(v)`) ;
 * une conversion dans une fonction déclarée prédicat (`: v is string`, `: boolean`) puis transtypée (`as any`).
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const API_DIR = join(ROOT, "server/api");

/** Occurrences relevées le 5 novembre 2026. Ne peut que rétrécir. */
const FROZEN: Record<string, number> = {};

/** Lectures lâches restantes dans `server/routes.ts` (gelé) : PATCH users et toggle admin-users, traités ailleurs. Ne peut que baisser. */
const ROUTES_TS_FROZEN = 2;

/** `parseInt(req.params…)`, `Number.parseInt(String(req.params.id), 10)`, `Number(request.params.id)`, `+req.params.id`, `parseFloat`. */
export function countLooseParamReads(source: string): number {
  const sf = ts.createSourceFile("f.ts", stripComments(source), ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    const value = looseNumericValue(node);
    if (value && readsRouteParam(unwrapValue(value))) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
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

/** `req.params…` (ou sous un autre nom de requête : premier paramètre du handler). */
function readsRouteParam(node: ts.Expression): boolean {
  let base: ts.Expression = node;
  while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
    if (isRequestPart(base, "params")) return true;
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

/**
 * Lecture lâche passée par une variable : `const { id } = req.params; parseInt(id)` (billing, 5 novembre 2026).
 * Compte chaque conversion lâche (`parseInt`, `Number`, parseur lâche du fichier) d'un nom lié depuis
 * `req.params` (`const { id } = …`, `const raw = req.params.id`), rattachée à sa déclaration par le
 * vérificateur (`tests/support/request-id-scan.ts`) : un nom masqué n'est pas compté.
 */
export function countLooseBoundParamReads(file: string, source: string, readModule: ReadModule = readTs): number {
  const loose = looseParsers(file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), readModule);
  return countBoundRequestConversions(
    file,
    source,
    "params",
    () => true,
    (node) =>
      looseNumericValue(node) ??
      (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && loose.has(node.expression.text) ? node.arguments[0] : undefined),
  );
}

function actualCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const n = countLooseParamReads(source) + countLooseParserCalls(file, source) + countLooseBoundParamReads(file, source);
    if (n > 0) counts[relative(API_DIR, file).replace(/\\/g, "/")] = n;
  }
  return counts;
}

describe("lecture des ids de route : parseRouteId, cliquet sur les lectures lâches de req.params", () => {
  it("aucune lecture lâche nouvelle, et la liste gelée suit les retraits", () => {
    expect(actualCounts()).toEqual(FROZEN);
  }, REPO_SCAN_TIMEOUT_MS);

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

  it("une lecture lâche passée par une variable liée depuis req.params est comptée", () => {
    const none: ReadModule = () => null;
    const handler = (body: string) => `router.get("/:id", async (req, res) => {\n${body}\n});`;
    expect(countLooseBoundParamReads("/x/a.ts", handler("const { id } = req.params;\nconst a = parseInt(id);\nf(Number(id as string));"), none)).toBe(2);
    expect(countLooseBoundParamReads("/x/a.ts", handler("const { id: raw } = req.params;\nconst a = Number.parseInt(raw, 10);"), none)).toBe(1);
    expect(countLooseBoundParamReads("/x/a.ts", handler("const raw = req.params.id;\nconst a = Number(raw);"), none)).toBe(1);
    expect(countLooseBoundParamReads("/x/a.ts", handler("const raw = req.params[\"id\"];\nconst a = parseInt(raw);"), none)).toBe(1);
    const viaParser = `function parseX(v: string) { return parseInt(v); }\n${handler("const { id } = req.params;\nconst a = parseX(id);")}`;
    expect(countLooseBoundParamReads("/x/a.ts", viaParser, none)).toBe(1);
    // Pas une lecture lâche : lecture stricte, nom non converti, nom homonyme d'un autre handler.
    expect(countLooseBoundParamReads("/x/a.ts", handler("const { id } = req.params;\nconst a = parseRouteId(id, 'm');"), none)).toBe(0);
    expect(countLooseBoundParamReads("/x/a.ts", handler("const { clientName } = req.params;\nconst a = clientName.trim();"), none)).toBe(0);
    const other = `${handler("const { id } = req.params;\nconst a = parseRouteId(id, 'm');")}\n${handler("const id = body.id;\nconst a = Number(id);")}`;
    expect(countLooseBoundParamReads("/x/a.ts", other, none)).toBe(0);
  });

  it("portée réelle : autre nom de requête, masquage, String(…)", () => {
    const none: ReadModule = () => null;
    const named = (body: string) => `router.get("/:id", async (request, response) => {\n${body}\n});`;
    expect(countLooseParamReads(named("const a = parseInt(request.params.id);"))).toBe(1);
    expect(countLooseParamReads("const a = Number.parseInt(String(req.params.id), 10);")).toBe(1);
    expect(countLooseBoundParamReads("/x/a.ts", named("const { id } = request.params;\nconst a = Number(id);"), none)).toBe(1);
    expect(countLooseBoundParamReads("/x/a.ts", named("const raw = request.params.id;\nconst a = parseInt(String(raw));"), none)).toBe(1);
    // Masqué : la conversion vise une autre variable que celle liée depuis req.params.
    const shadowFor = named("const { id } = request.params;\nfor (const { id } of rows) f(parseInt(id));\nconst a = parseRouteId(id, 'm');");
    expect(countLooseBoundParamReads("/x/a.ts", shadowFor, none)).toBe(0);
    const shadowParam = named("const { id } = request.params;\nrows.map((id) => Number(id));");
    expect(countLooseBoundParamReads("/x/a.ts", shadowParam, none)).toBe(0);
    // Visible dans une fonction interne : compté.
    const closure = named("const { id } = request.params;\nrows.map(() => Number(id));");
    expect(countLooseBoundParamReads("/x/a.ts", closure, none)).toBe(1);
    expect(countLooseParamReads("const a = +req.params.id;\nconst b = parseFloat(req.params.id);")).toBe(2);
    expect(countLooseBoundParamReads("/x/a.ts", named("const { id } = request.params;\nconst a = +id;"), none)).toBe(1);
    // Chemin Windows (`server\api\…`) : même compte qu'avec des `/`.
    expect(countLooseBoundParamReads(String.raw`C:\x\server\api\a.ts`, closure, none)).toBe(1);
    // `params` d'un objet qui n'est pas la requête : pas compté.
    expect(countLooseParamReads(named("const a = Number(route.params.id);"))).toBe(0);
  });

  it("server/routes.ts (gelé) : le nombre de lectures lâches ne peut que baisser", () => {
    // 50 relevées par ce motif le 5 novembre 2026 (origin/main) ; 11 lectures passent à routeIdOrNaN au lot 5 (9 DELETE + 2 GET d'OT).
    expect(countLooseParamReads(readFileSync(join(ROOT, "server/routes.ts"), "utf8"))).toBe(ROUTES_TS_FROZEN);
  });

  it("routeIdOrNaN reste cantonné à server/routes.ts (les routeurs neufs lèvent par parseRouteId)", () => {
    const users = sourceFiles(join(ROOT, "server"))
      .filter((file) => /\brouteIdOrNaN\b/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
      .sort();
    expect(users).toEqual(["server/lib/route-id.ts", "server/routes.ts"]);
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
