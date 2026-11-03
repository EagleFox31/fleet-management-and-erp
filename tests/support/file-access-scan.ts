import ts from "typescript";
import { scopeOf } from "./alert-emission-scan";

/**
 * Recense les accès disque côté serveur qui lisent, servent, copient, déplacent ou suppriment un
 * fichier (AGENTS.md §9) et dit si le chemin passé est borné à `uploads/`.
 *
 * Accès : appel dont le nom figure dans `ACCESS_CALLS` (`fs.x`, `res.x` ou import nommé).
 * Borné : le premier argument est relié à une borne (`uploadedFileCandidates`,
 * `existingUploadedFile`, `isInsideDirectory`) dans la même portée :
 *   - l'argument contient lui-même l'appel de borne ;
 *   - ou c'est un identifiant `x` déclaré depuis une expression qui appelle une borne ;
 *   - ou c'est un identifiant `x` passé en argument à un appel de borne (garde `if (!isInsideDirectory(dir, x))`).
 * La recherche se fait sur l'AST, pas sur le texte : un commentaire ou une borne appliquée à une
 * autre variable ne comptent pas.
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

/** Identifiant qui désigne une valeur (pas le nom de propriété de `a.b`). */
function isValueIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && !(node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);
}

function mentions(node: ts.Node, name: string): boolean {
  if (isValueIdentifier(node) && node.text === name) return true;
  return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false;
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

/** Espaces de noms de modules : `path.resolve(root, "uploads")` ne borne pas `path`. */
const NAMESPACES = new Set(["path", "fs", "fsp", "process"]);

function identifiersIn(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (current: ts.Node) => {
    if (isValueIdentifier(current) && !NAMESPACES.has(current.text)) names.add(current.text);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

/** `name` est borné : gardé par un appel de borne, ou déclaré (en chaîne) depuis une expression bornée. */
function isBoundName(name: string, scope: ts.Node, seen: Set<string>): boolean {
  if (seen.has(name) || NAMESPACES.has(name)) return false;
  seen.add(name);
  if (boundCallsIn(scope).some((call) => call.arguments.some((arg) => mentions(arg, name)))) return true;
  return initializersOf(name, scope).some(
    (init) => boundCallsIn(init).length > 0 || [...identifiersIn(init)].some((dep) => isBoundName(dep, scope, seen)),
  );
}

function isBoundArgument(argument: ts.Expression | undefined, scope: ts.Node): boolean {
  if (!argument) return false;
  if (boundCallsIn(argument).length > 0) return true;
  return ts.isIdentifier(argument) && isBoundName(argument.text, scope, new Set());
}

/** Imports renommés d'un appel disque (`import { unlink as del }`) : ils échapperaient au scan. */
export function renamedAccessImports(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const renamed: string[] = [];
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.propertyName && ACCESS_CALLS.has(element.propertyName.text)) renamed.push(`${file}:${element.propertyName.text} as ${element.name.text}`);
    }
  }
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
          bounded: isBoundArgument(node.arguments[0], scope?.node ?? source),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

export const fileAccessKey = (site: Pick<FileAccessSite, "file" | "scope" | "call">) => `${site.file}:${site.scope}:${site.call}`;
