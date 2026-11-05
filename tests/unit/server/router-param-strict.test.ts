import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles, REPO_SCAN_TIMEOUT_MS } from "../../support/repo-files";

/**
 * Une garde refuse ce qu'elle ne sait pas lire (#353) : tout `<x>.param(nom, callback)` de `server/`
 * appelle un parseur strict sur la valeur avant de laisser passer la requête. Sinon une valeur
 * invalide atteint un handler qui relit le paramètre autrement (`parseInt` tolère un suffixe).
 *
 * Forme exigée, lue sur l'AST (l'ancienne version textuelle ne voyait que `return next()` et
 * laissait passer `next(); return;`) :
 *   - le callback est une fonction littérale à quatre paramètres `(req, res, next, value)` ;
 *   - une instruction `parseX(value)` (appel direct, ou initialiseur d'un `const`) figure au
 *     premier niveau du corps, ou au premier niveau d'un `try` lui-même au premier niveau ;
 *   - tout appel de passage est placé après elle dans ce même bloc (ou dans un bloc imbriqué qui
 *     suit) : aucune sortie ne la contourne. Passage = `next()`, `next("route")`, ou `next` avec
 *     une valeur fausse (`null`, `undefined`, `void 0`, `false`, `0`, `""`), qu'Express traite
 *     comme un passage normal ;
 *   - `parseX` n'est pas `parseInt` / `parseFloat` ; s'il est déclaré dans le fichier, son corps
 *     contient un `throw` (un parseur strict refuse, il ne rend pas `NaN`).
 * `next(err)` (appel avec une autre expression) est une sortie en erreur, toujours permise.
 * Un `.param` dont le nom n'est pas une chaîne littérale (`param(["id"], cb)`, `param(nom, cb)`)
 * est signalé illisible.
 *
 * Limites connues :
 *   - refusés à tort (faux positif) : callback nommé ou importé, parseur appelé dans une condition ;
 *   - non vus (faux négatif) : parseur importé d'un autre module (son `throw` n'est pas vérifié),
 *     alias de `next` (`const go = next; go()`), `next` passé à une fonction imbriquée ou différée
 *     (`setImmediate(next)`, `.then(() => next())`), et `.param (` écrit avec une espace, qui échappe
 *     au préfiltre textuel du scan de dépôt.
 */

const LOOSE_PARSERS = new Set(["parseInt", "parseFloat"]);

export type ParamGuard = { key: string; problem: string | null };

export function scanRouterParams(file: string, text: string): ParamGuard[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const throwingParsers = localParsersThatThrow(source);
  const found: ParamGuard[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "param" &&
      node.arguments.length === 2
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const [name, callback] = node.arguments;
      if (ts.isStringLiteralLike(name)) {
        found.push({ key: `${file}:${line} param("${name.text}")`, problem: checkCallback(callback, throwingParsers) });
      } else {
        found.push({ key: `${file}:${line} param(${name.getText()})`, problem: "nom non littéral : illisible" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function checkCallback(callback: ts.Expression, throwingParsers: Map<string, boolean>): string | null {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return "callback non littéral : illisible";
  const [, , nextParam, valueParam] = callback.parameters;
  if (!nextParam || !valueParam || !ts.isIdentifier(nextParam.name) || !ts.isIdentifier(valueParam.name)) {
    return "callback sans paramètres (req, res, next, value)";
  }
  if (!ts.isBlock(callback.body)) return "corps en expression : illisible";
  const next = nextParam.name.text;
  const value = valueParam.name.text;

  // Blocs où la ligne de parsage peut vivre : le corps, ou un `try` de premier niveau.
  const candidates: ts.Block[] = [callback.body];
  for (const s of callback.body.statements) if (ts.isTryStatement(s)) candidates.push(s.tryBlock);

  let parse: { block: ts.Block; index: number; name: string } | null = null;
  for (const block of candidates) {
    const index = block.statements.findIndex((s) => parserCallOf(s, value) !== null);
    if (index !== -1) {
      parse = { block, index, name: parserCallOf(block.statements[index], value)! };
      break;
    }
  }
  if (!parse) return `aucun parseur strict appelé sur « ${value} » au premier niveau`;
  if (LOOSE_PARSERS.has(parse.name)) return `${parse.name} n'est pas un parseur strict`;
  if (throwingParsers.get(parse.name) === false) return `${parse.name} ne lève jamais : pas un parseur strict`;

  const parseStatement = parse.block.statements[parse.index];
  const early = passCalls(callback.body, next).find((call) => !isAfter(call, parseStatement, parse!.block));
  if (early) return `next() avant ${parse.name}(${value}) : « ${early.getText()} »`;
  return null;
}

/** Nom du parseur si l'instruction est `parseX(value)` ou `const y = parseX(value)` (await toléré). */
function parserCallOf(statement: ts.Statement, value: string): string | null {
  let expr: ts.Expression | undefined;
  if (ts.isExpressionStatement(statement)) expr = statement.expression;
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    expr = statement.declarationList.declarations[0].initializer;
  }
  if (expr && ts.isAwaitExpression(expr)) expr = expr.expression;
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return null;
  const name = expr.expression.text;
  if (!/^parse[A-Z]/.test(name)) return null;
  const arg = expr.arguments[0];
  return arg && ts.isIdentifier(arg) && arg.text === value ? name : null;
}

/** Valeur qu'Express traite comme un passage : chaîne (`"route"`, `""`) ou valeur fausse littérale. */
function isPassArgument(arg: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(arg) || ts.isAsExpression(arg) || ts.isNonNullExpression(arg)) arg = arg.expression;
  if (ts.isStringLiteralLike(arg)) return true;
  if (arg.kind === ts.SyntaxKind.NullKeyword || arg.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(arg) && arg.text === "undefined") return true;
  if (ts.isVoidExpression(arg)) return true;
  return ts.isNumericLiteral(arg) && Number(arg.text) === 0;
}

/** Appels qui laissent passer la requête (`next()`, `next("route")`, `next(null)`…), hors fonctions imbriquées. */
function passCalls(body: ts.Block, next: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === next) {
      const [arg] = node.arguments;
      if (!arg || isPassArgument(arg)) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return calls;
}

/** Vrai si `call` est dans une instruction de `block` située après `parseStatement`. */
function isAfter(call: ts.Node, parseStatement: ts.Statement, block: ts.Block): boolean {
  let node: ts.Node = call;
  while (node.parent && node.parent !== block) node = node.parent;
  if (node.parent !== block) return false;
  return block.statements.indexOf(node as ts.Statement) > block.statements.indexOf(parseStatement);
}

/** Parseurs `parseX` déclarés dans le fichier : vrai si leur corps contient un `throw`. */
function localParsersThatThrow(source: ts.SourceFile): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const hasThrow = (node: ts.Node): boolean => ts.isThrowStatement(node) || ts.forEachChild(node, hasThrow) === true;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /^parse[A-Z]/.test(node.name.text) && node.body) {
      result.set(node.name.text, hasThrow(node.body));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^parse[A-Z]/.test(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      result.set(node.name.text, hasThrow(node.initializer.body));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

const STRICT_PARSER = `function parseThingId(v: unknown): number { if (typeof v !== "string") throw new Error("x"); return Number(v); }\n`;
const sample = (callback: string, prelude = STRICT_PARSER) => scanRouterParams("sample.ts", `${prelude}router.param("id", ${callback});`)[0].problem;

describe("router.param : parseur strict avant next() (#353)", { timeout: REPO_SCAN_TIMEOUT_MS }, () => {
  it("cas synthétiques : formes refusées", () => {
    // Mutations de la garde de missions : chacune doit être vue.
    expect(sample(`async (req, res, next, value) => { if (!/^\\d+$/.test(value)) { next(); return; } parseThingId(value); next(); }`)).toMatch(/next\(\) avant/);
    expect(sample(`async (req, res, next, value) => { if (!value) return next(); const id = parseThingId(value); next(); }`)).toMatch(/next\(\) avant/);
    expect(sample(`(req, res, next, value) => { try { next("route"); const id = parseThingId(value); } catch (e) { next(e); } }`)).toMatch(/next\(\) avant/);
    expect(sample(`(req, res, next, value) => { if (value) { const id = parseThingId(value); } next(); }`)).toMatch(/aucun parseur/);
    expect(sample(`(req, res, next, value) => { const id = parseInt(value); next(); }`)).toMatch(/parseInt n'est pas/);
    expect(sample(`(req, res, next, value) => { const id = parseLoose(value); next(); }`, `const parseLoose = (v: string) => Number(v);\n`)).toMatch(/ne lève jamais/);
    expect(sample(`(req, res, next, value) => { const id = parseThingId(req.query.id); next(); }`)).toMatch(/aucun parseur/);
    for (const pass of ["null", "undefined", "void 0", "false", "0", `""`]) {
      expect(sample(`(req, res, next, value) => { if (!value) { next(${pass}); return; } parseThingId(value); next(); }`)).toMatch(/next\(\) avant/);
    }
    expect(scanRouterParams("s.ts", `router.param(["id"], (req, res, next, value) => { next(); });`)[0].problem).toMatch(/nom non littéral/);
    expect(scanRouterParams("s.ts", `const k = "id";\nrouter.param(k, (req, res, next, value) => { next(); });`)[0].problem).toMatch(/nom non littéral/);
    expect(sample(`checkId`)).toMatch(/non littéral/);
    expect(sample(`(req, res, next) => { next(); }`)).toMatch(/sans paramètres/);
  });

  it("cas synthétiques : formes acceptées", () => {
    expect(sample(`async (req, _res, next, value) => { try { const id = parseThingId(value); if (!(await ok(id))) throw new Error("403"); next(); } catch (error) { next(error); } }`)).toBeNull();
    expect(sample(`function (req, res, next, value) { parseThingId(value); next(); }`)).toBeNull();
    expect(sample(`(req, res, next, value) => { const id = parseThingId(value); if (id > 3) { return next(); } next(); }`)).toBeNull();
  });

  it("le scan voit la garde de missions (il n'est pas aveugle)", async () => {
    const scanned = scanRouterParams("server/api/missions.routes.ts", await readRepoFile("server/api/missions.routes.ts"));
    expect(scanned.map((p) => p.key)).toEqual([expect.stringMatching(/^server\/api\/missions\.routes\.ts:\d+ param\("id"\)$/)]);
  });

  it("tout router.param de server/ appelle un parseur strict avant next()", async () => {
    const offenders: string[] = [];
    for (const file of repoFiles({ under: ["server"], match: /\.ts$/, skipSegments: ["_archive"] })) {
      const text = await readRepoFile(file);
      if (!text.includes(".param(")) continue;
      for (const p of scanRouterParams(file, text)) if (p.problem) offenders.push(`${p.key} : ${p.problem}`);
    }
    expect(offenders).toEqual([]);
  });
});
