import ts from "typescript";

/**
 * Repérage des lectures d'id de requête (`req.params`, `req.query`) pour les cliquets
 * `route-id-parse-hygiene` et `query-id-parse-hygiene`.
 *
 * - Objet requête : `req`, ou le premier paramètre de la fonction englobante (`(request, res) =>`).
 * - Variable liée : `const { id } = req.params`, `const raw = req.query.vehicleId`. Chaque conversion
 *   est rattachée à sa déclaration par le vérificateur de TypeScript (un seul fichier, sans lib) :
 *   un nom masqué par une déclaration interne (`for (const { id } of rows)`, paramètre homonyme)
 *   n'est pas compté, et un nom lié n'est pas cherché ailleurs que là où il est visible.
 *
 * Limites : un alias de la requête (`const r = req; r.params.id`) n'est pas suivi, seul le
 * renommage du premier paramètre l'est. Une valeur passée par une autre variable (`const a = id`)
 * ou par un autre fichier n'est pas suivie non plus.
 */

export type RequestPart = "params" | "query";

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
}

/** `req`, ou le premier paramètre de la fonction qui englobe la lecture. */
export function isRequestObject(node: ts.Expression): boolean {
  if (!ts.isIdentifier(node)) return false;
  if (node.text === "req") return true;
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (isFunctionLike(current)) {
      const first = current.parameters[0];
      if (first && ts.isIdentifier(first.name) && first.name.text === node.text) return true;
    }
  }
  return false;
}

/** `req.params` / `req.query` (ou leur équivalent sous un autre nom de requête). */
export function isRequestPart(node: ts.Expression, part: RequestPart): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === part && isRequestObject(node.expression);
}

/** `req.<part>.x` ou `req.<part>["x"]` : le nom lu, sinon `null`. */
export function requestFieldName(node: ts.Expression, part: RequestPart): string | null {
  if (ts.isPropertyAccessExpression(node) && isRequestPart(node.expression, part)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isRequestPart(node.expression, part) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** Retire `( )`, `as T`, `!` et `String(…)` autour d'une valeur. */
export function unwrapValue(node: ts.Expression): ts.Expression {
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

/**
 * Identifiants liés depuis `req.<part>` par une déclaration, filtrés sur le nom du champ lu :
 * `const { a, b: c } = req.query` lie `a` (champ `a`) et `c` (champ `b`).
 */
function boundIdentifiers(decl: ts.VariableDeclaration, part: RequestPart, field: (name: string) => boolean): ts.Identifier[] {
  const init = decl.initializer && unwrapValue(decl.initializer);
  if (!init) return [];
  if (isRequestPart(init, part) && ts.isObjectBindingPattern(decl.name)) {
    return decl.name.elements.flatMap((el) => {
      const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
      return field(key) && ts.isIdentifier(el.name) ? [el.name] : [];
    });
  }
  const read = requestFieldName(init, part);
  return read !== null && field(read) && ts.isIdentifier(decl.name) ? [decl.name] : [];
}

/**
 * Programme d'un seul fichier, sans lib ni résolution : assez pour relier un nom à sa déclaration.
 * `createProgram` normalise les chemins en `/` : un chemin Windows (`C:\x\a.ts`) comparé tel quel
 * ne serait jamais trouvé, et le compte tomberait à 0.
 */
function singleFileChecker(rawName: string, source: string): { sf: ts.SourceFile; checker: ts.TypeChecker } {
  const fileName = rawName.split("\\").join("/");
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
  };
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true, types: [], allowJs: false }, host);
  return { sf: program.getSourceFile(fileName) ?? sf, checker: program.getTypeChecker() };
}

/**
 * Compte les conversions (`converted(node)` rend la valeur convertie) d'un nom lié depuis
 * `req.<part>` par un champ accepté par `field`, résolu à sa déclaration.
 */
export function countBoundRequestConversions(
  fileName: string,
  source: string,
  part: RequestPart,
  field: (name: string) => boolean,
  converted: (node: ts.Node) => ts.Expression | undefined,
): number {
  const { sf, checker } = singleFileChecker(fileName, source);
  const bound = new Set<ts.Symbol>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      for (const id of boundIdentifiers(node, part, field)) {
        const symbol = checker.getSymbolAtLocation(id);
        if (symbol) bound.add(symbol);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  if (bound.size === 0) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    const value = converted(node);
    if (value) {
      const arg = unwrapValue(value);
      if (ts.isIdentifier(arg)) {
        const symbol = checker.getSymbolAtLocation(arg);
        if (symbol && bound.has(symbol)) count += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/**
 * Conversion numérique lâche : `parseInt`, `parseFloat`, `Number`, `Number.parseInt`,
 * `Number.parseFloat` (premier argument) ou `+x` (opérande). Sinon `undefined`.
 */
export function looseNumericValue(node: ts.Node): ts.Expression | undefined {
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) return node.operand;
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
  const callee = node.expression;
  const global = ts.isIdentifier(callee) && ["parseInt", "parseFloat", "Number"].includes(callee.text);
  const member =
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Number" &&
    ["parseInt", "parseFloat"].includes(callee.name.text);
  return global || member ? node.arguments[0] : undefined;
}
