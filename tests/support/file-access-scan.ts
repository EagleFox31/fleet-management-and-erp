import ts from "typescript";
import { scopeOf } from "./alert-emission-scan";

/**
 * Recense les accès disque côté serveur qui lisent, servent, copient, déplacent ou suppriment un
 * fichier (AGENTS.md §9) et dit si le chemin passé est borné à `uploads/`.
 *
 * Accès : appel dont le nom figure dans `ACCESS_CALLS` (`fs.x`, `res.x` ou import nommé).
 * Borné : le chemin est relié à une borne (`uploadedFileCandidates`, `existingUploadedFile`,
 * `isInsideDirectory`) dans la même portée, par la structure de l'expression (`isBoundExpression`) :
 * résultat d'un appel de borne, accès ou méthode sur ce résultat, variable dont toutes les
 * déclarations sont bornées, ou variable reçue directement par un appel de borne (garde).
 * `a ?? b` n'est borné que si chaque branche l'est. Pour `copyFile`, `cp` et `rename`, la
 * destination doit être bornée elle aussi. Les alias d'un appel disque sont refusés.
 * La recherche se fait sur l'AST : un commentaire, ou une borne posée sur une autre variable
 * (y compris un autre champ de `req`), ne comptent pas.
 *
 * Limites connues (garde statique, pas une preuve) :
 *   - borne appelée mais résultat ignoré : `isInsideDirectory(dir, p); fs.unlinkSync(p)` est jugé
 *     borné, que le `if` refuse ou non ;
 *   - une réaffectation (`p = req.body.p` après une déclaration bornée) n'est pas suivie ;
 *   - un chemin passé à une autre fonction est jugé dans la portée de celle-ci, sans suivre l'appelant.
 */

export type FileAccessSite = { file: string; scope: string; call: string; line: number; bounded: boolean };

export const ACCESS_CALLS = new Set([
  "sendFile",
  "download",
  "createReadStream",
  "readFile",
  "readFileSync",
  "open",
  "openSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "rename",
  "renameSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
]);
const BOUND_CALLS = new Set(["uploadedFileCandidates", "existingUploadedFile", "isInsideDirectory"]);

function calleeName(node: ts.CallExpression): string | null {
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) return callee.argumentExpression.text;
  return ts.isIdentifier(callee) ? callee.text : null;
}

function boundCallsIn(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current) && BOUND_CALLS.has(calleeName(current) ?? "")) found.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function initializersOf(name: string, scope: ts.Node): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.name.text === name && current.initializer) {
      found.push(current.initializer);
    }
    // for (const x of <expression>) : x vient de l'expression itérée.
    if (ts.isForOfStatement(current) && ts.isVariableDeclarationList(current.initializer)) {
      const [declaration] = current.initializer.declarations;
      if (declaration && ts.isIdentifier(declaration.name) && declaration.name.text === name) found.push(current.expression);
    }
    ts.forEachChild(current, visit);
  };
  visit(scope);
  return found;
}

/**
 * `name` est borné :
 *   - gardé : `isInsideDirectory` le reçoit **directement** en argument (`isInsideDirectory(dir, name)`) ;
 *   - ou déclaré : toutes ses déclarations dans la portée sont des expressions bornées.
 * Un paramètre ou `req` n'a pas de déclaration locale : il n'est borné que gardé directement.
 */
function isBoundName(name: string, scope: ts.Node, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  // Seul isInsideDirectory est une garde : uploadedFileCandidates(p) borne son résultat, pas p.
  const guarded = boundCallsIn(scope).some((call) =>
    calleeName(call) === "isInsideDirectory" && call.arguments.some((arg) => {
      const inner = unwrap(arg);
      return ts.isIdentifier(inner) && inner.text === name;
    }),
  );
  if (guarded) return true;
  const initializers = initializersOf(name, scope);
  return initializers.length > 0 && initializers.every((init) => isBoundExpression(init, scope, seen));
}

/**
 * Expression bornée, par sa structure :
 *   - appel de borne (`uploadedFileCandidates(p)`) ;
 *   - accès ou méthode sur une valeur bornée (`candidates[0]`, `candidates.find(…)`) ;
 *   - identifiant borné (`isBoundName`) ;
 *   - `a ?? b`, `a || b`, `c ? a : b` : **chaque** branche bornée (`candidates[0] ?? p` ne l'est pas).
 */
function isBoundExpression(node: ts.Expression, scope: ts.Node, seen: Set<string>): boolean {
  const expr = unwrap(node);
  if (ts.isCallExpression(expr)) {
    if (BOUND_CALLS.has(calleeName(expr) ?? "")) return true;
    return ts.isPropertyAccessExpression(expr.expression) && isBoundExpression(expr.expression.expression, scope, seen);
  }
  if (ts.isElementAccessExpression(expr)) return isBoundExpression(expr.expression, scope, seen);
  if (ts.isIdentifier(expr)) return isBoundName(expr.text, scope, seen);
  if (ts.isBinaryExpression(expr)) {
    const kind = expr.operatorToken.kind;
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) {
      return isBoundExpression(expr.left, scope, new Set(seen)) && isBoundExpression(expr.right, scope, new Set(seen));
    }
    return false;
  }
  if (ts.isConditionalExpression(expr)) {
    return isBoundExpression(expr.whenTrue, scope, new Set(seen)) && isBoundExpression(expr.whenFalse, scope, new Set(seen));
  }
  return false;
}

/** Appels qui écrivent à une destination : la destination doit être bornée elle aussi. */
const TWO_PATH_CALLS = new Set(["copyFile", "copyFileSync", "cp", "cpSync", "rename", "renameSync"]);

function isBoundAccess(node: ts.CallExpression, call: string, scope: ts.Node): boolean {
  const [source, destination] = node.arguments;
  if (!source || !isBoundExpression(source, scope, new Set())) return false;
  if (!TWO_PATH_CALLS.has(call)) return true;
  return !!destination && isBoundExpression(destination, scope, new Set());
}

/**
 * Alias d'un appel disque, qui échapperaient au scan par nom :
 * `import { unlink as del }`, `const { unlink: del } = fs`, `const del = fs.unlinkSync`.
 */
export function renamedAccessImports(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const renamed: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportSpecifier(node) && node.propertyName && ACCESS_CALLS.has(node.propertyName.text)) {
      renamed.push(`${file}:${node.propertyName.text} as ${node.name.text}`);
    }
    if (
      ts.isBindingElement(node) &&
      node.propertyName &&
      ts.isIdentifier(node.propertyName) &&
      ACCESS_CALLS.has(node.propertyName.text) &&
      ts.isIdentifier(node.name)
    ) {
      renamed.push(`${file}:${node.propertyName.text} as ${node.name.text}`);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      ACCESS_CALLS.has(node.initializer.name.text)
    ) {
      renamed.push(`${file}:${node.initializer.name.text} as ${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return renamed;
}

export function scanFileAccesses(file: string, text: string): FileAccessSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: FileAccessSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const call = calleeName(node);
      if (call && ACCESS_CALLS.has(call)) {
        const scope = scopeOf(node);
        sites.push({
          file,
          scope: scope?.name ?? "<module>",
          call,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          bounded: isBoundAccess(node, call, scope?.node ?? source),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

export const fileAccessKey = (site: Pick<FileAccessSite, "file" | "scope" | "call">) => `${site.file}:${site.scope}:${site.call}`;
