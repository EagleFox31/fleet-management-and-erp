import ts from "typescript";
import { scopeOf } from "./alert-emission-scan";

/**
 * Recense les accès disque côté serveur qui lisent, servent, copient, déplacent ou suppriment un
 * fichier (AGENTS.md §9) et dit si le chemin passé est borné à `uploads/`.
 *
 * Accès : appel dont le nom figure dans `ACCESS_CALLS` (`fs.x`, `res.x` ou import nommé).
 * Borné : le chemin est relié à une borne (`uploadedFileCandidates`, `existingUploadedFile`,
 * `settlementProofPath`, `isInsideDirectory`) dans la même portée, par la structure de l'expression (`isBoundExpression`) :
 * résultat d'un appel de borne, accès ou méthode sur ce résultat, variable dont toutes les
 * déclarations sont bornées, ou variable reçue directement par un appel de borne (garde).
 * `a ?? b` n'est borné que si chaque branche l'est. Pour `copyFile`, `cp` et `rename`, la
 * destination doit être bornée elle aussi. Les alias d'un appel disque sont refusés.
 * La recherche se fait sur l'AST : un commentaire, ou une borne posée sur une autre variable
 * (y compris un autre champ de `req`), ne comptent pas.
 *
 * Garde : `isInsideDirectory(dir, p)` ne borne `p` que s'il en est le **second** argument (le
 * candidat), placé **avant** l'accès et dans la **même fonction** : une garde dans un rappel ou
 * après l'appel disque ne compte pas. `dir` doit être une racine `uploads` connue (`isUploadsRoot`) :
 * `isInsideDirectory(path.dirname(p), p)` ou `isInsideDirectory(req.body.dir, p)` ne bornent rien. Méthode sur une valeur bornée : seules `find`, `filter`,
 * `at` et `slice` gardent le résultat borné (`candidates.concat(p)[0]` ne l'est pas).
 *
 * Limites connues (garde statique, pas une preuve) :
 *   - borne appelée mais résultat ignoré : `isInsideDirectory(dir, p); fs.unlinkSync(p)` est jugé
 *     borné, que le `if` refuse ou non ; une garde dans une branche (`if (x) isInsideDirectory(…)`)
 *     compte comme si elle précédait l'accès sur tous les chemins ;
 *   - une réaffectation (`p = req.body.p` après une déclaration bornée) n'est pas suivie, ni le
 *     masquage par bloc (`{ const p = req.body.p; … }` : les déclarations sont lues par nom dans toute
 *     la portée, pas par bloc) ;
 *   - `slice` et `at` sont jugés sur des tableaux : appliqués à une chaîne bornée
 *     (`existingUploadedFile(p)?.slice(1)`), le résultat est jugé borné à tort ;
 *   - les écritures (`writeFile*`, `appendFile*`, `createWriteStream`, `mkdir*`) ne figurent pas dans
 *     `ACCESS_CALLS` : non couvertes, à suivre en dette ;
 *   - un chemin passé à une autre fonction est jugé dans la portée de celle-ci, sans suivre l'appelant ;
 *   - racine `uploads` : seul un `..` littéral passé directement à join/resolve après `uploads` est
 *     refusé. Trois formes passent encore pour bornées : `path.join("uploads", path.join("..", ".."))`
 *     (`..` imbriqué), `const UP = ".."; path.join("uploads", UP)` (`..` par constante) et
 *     `path.resolve("uploads", "/etc")` (un absolu remplace la racine).
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
const BOUND_CALLS = new Set(["uploadedFileCandidates", "existingUploadedFile", "settlementProofPath", "isInsideDirectory"]);

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

/** Fonction englobante la plus proche (ou le fichier) : la garde doit vivre dans la même que l'accès. */
function enclosingFunction(node: ts.Node): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  }
  return node.getSourceFile();
}

/**
 * Racine `uploads` connue : littéral contenant `uploads`, `path.join` / `path.resolve` dont **tous**
 * les arguments sont des morceaux sûrs et au moins un nomme `uploads`, ou identifiant dont toutes les
 * déclarations du fichier le sont. `path.join(req.body.dir, "uploads")` et
 * `path.resolve("uploads", req.body.dir)` ne bornent rien : la racine vient de la requête.
 */
function isUploadsRoot(node: ts.Expression, seen = new Set<string>()): boolean {
  return rootKind(node, seen) === "uploads";
}

const UPLOADS_SEGMENT = /(^|[\\/.])uploads([\\/]|$)/;
const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/;

/**
 * Nature d'un morceau de racine : `uploads` (nomme le dossier), `neutral` (littéral, `process.cwd()`,
 * `__dirname`, constante qui l'est), sinon `unknown`. Un `..` placé après `uploads` en sort : `unknown`.
 */
function rootKind(node: ts.Expression, seen: Set<string>): "uploads" | "neutral" | "unknown" {
  const expr = unwrap(node);
  if (ts.isStringLiteralLike(expr)) {
    const match = UPLOADS_SEGMENT.exec(expr.text);
    if (!match) return "neutral";
    return PARENT_SEGMENT.test(expr.text.slice(match.index + match[0].length - 1)) ? "unknown" : "uploads";
  }
  if (ts.isIdentifier(expr) && expr.text === "__dirname") return "neutral";
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "cwd" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "process" &&
      expr.arguments.length === 0
    ) {
      return "neutral";
    }
    const name = calleeName(expr);
    if (name !== "join" && name !== "resolve") return "unknown";
    let named = false;
    for (const arg of expr.arguments) {
      const kind = rootKind(arg, seen);
      if (kind === "unknown") return "unknown";
      // un `..` après le segment uploads remonte hors du dossier
      if (named && ts.isStringLiteralLike(unwrap(arg)) && PARENT_SEGMENT.test((unwrap(arg) as ts.StringLiteralLike).text)) return "unknown";
      if (kind === "uploads") named = true;
    }
    return named ? "uploads" : "neutral";
  }
  if (ts.isIdentifier(expr)) {
    if (seen.has(expr.text)) return "unknown";
    seen.add(expr.text);
    const initializers = initializersOf(expr.text, expr.getSourceFile());
    if (initializers.length === 0) return "unknown";
    const kinds = initializers.map((init) => rootKind(init, seen));
    if (kinds.every((kind) => kind === "uploads")) return "uploads";
    return kinds.every((kind) => kind === "neutral") ? "neutral" : "unknown";
  }
  return "unknown";
}

/** Méthodes dont le résultat reste dans l'ensemble borné (sous-ensemble ou élément). */
const BOUND_PRESERVING_METHODS = new Set(["find", "filter", "at", "slice"]);

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
 *   - gardé : `isInsideDirectory` le reçoit **directement** en second argument (`isInsideDirectory(dir, name)`),
 *     avant `at` et dans la même fonction ;
 *   - ou déclaré : toutes ses déclarations dans la portée sont des expressions bornées.
 * Un paramètre ou `req` n'a pas de déclaration locale : il n'est borné que gardé directement.
 */
function isBoundName(name: string, scope: ts.Node, seen: Set<string>, at: ts.Node): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  // Seul isInsideDirectory est une garde : uploadedFileCandidates(p) borne son résultat, pas p.
  const guarded = boundCallsIn(scope).some((call) => {
    if (calleeName(call) !== "isInsideDirectory" || !call.arguments[1] || !isUploadsRoot(call.arguments[0])) return false;
    const candidate = unwrap(call.arguments[1]);
    return (
      ts.isIdentifier(candidate) &&
      candidate.text === name &&
      call.getEnd() <= at.getStart() &&
      enclosingFunction(call) === enclosingFunction(at)
    );
  });
  if (guarded) return true;
  const initializers = initializersOf(name, scope);
  return initializers.length > 0 && initializers.every((init) => isBoundExpression(init, scope, seen, init));
}

/**
 * Expression bornée, par sa structure :
 *   - appel de borne (`uploadedFileCandidates(p)`) ;
 *   - accès, ou méthode de `BOUND_PRESERVING_METHODS`, sur une valeur bornée (`candidates[0]`, `candidates.find(…)`) ;
 *   - identifiant borné (`isBoundName`) ;
 *   - `a ?? b`, `a || b`, `c ? a : b` : **chaque** branche bornée (`candidates[0] ?? p` ne l'est pas).
 */
function isBoundExpression(node: ts.Expression, scope: ts.Node, seen: Set<string>, at: ts.Node): boolean {
  const expr = unwrap(node);
  if (ts.isCallExpression(expr)) {
    if (BOUND_CALLS.has(calleeName(expr) ?? "")) return true;
    return (
      ts.isPropertyAccessExpression(expr.expression) &&
      BOUND_PRESERVING_METHODS.has(expr.expression.name.text) &&
      isBoundExpression(expr.expression.expression, scope, seen, at)
    );
  }
  if (ts.isElementAccessExpression(expr)) return isBoundExpression(expr.expression, scope, seen, at);
  if (ts.isIdentifier(expr)) return isBoundName(expr.text, scope, seen, at);
  if (ts.isBinaryExpression(expr)) {
    const kind = expr.operatorToken.kind;
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) {
      return isBoundExpression(expr.left, scope, new Set(seen), at) && isBoundExpression(expr.right, scope, new Set(seen), at);
    }
    return false;
  }
  if (ts.isConditionalExpression(expr)) {
    return isBoundExpression(expr.whenTrue, scope, new Set(seen), at) && isBoundExpression(expr.whenFalse, scope, new Set(seen), at);
  }
  return false;
}

/** Appels qui écrivent à une destination : la destination doit être bornée elle aussi. */
const TWO_PATH_CALLS = new Set(["copyFile", "copyFileSync", "cp", "cpSync", "rename", "renameSync"]);

function isBoundAccess(node: ts.CallExpression, call: string, scope: ts.Node): boolean {
  const [source, destination] = node.arguments;
  if (!source || !isBoundExpression(source, scope, new Set(), node)) return false;
  if (!TWO_PATH_CALLS.has(call)) return true;
  return !!destination && isBoundExpression(destination, scope, new Set(), node);
}

/**
 * Alias d'un appel disque, qui échapperaient au scan par nom :
 * `import { unlink as del }`, `const { unlink: del } = fs`, et toute référence non appelée à un
 * membre disque : `const del = fs.unlinkSync`, `del = fs["unlinkSync"]`, `fs.unlinkSync.bind(fs)`,
 * `promisify(fs.unlink)`. Un accès à `fs` par clé non littérale (`fs[k](p)`) est signalé lui aussi :
 * le scan ne peut pas savoir quel appel il vise.
 */
const FS_OBJECTS = /^(fs|fsp|fsPromises|promises|fs\.promises)$/;
function aliasLabel(member: ts.Expression): string {
  let node: ts.Node = member;
  // fs.unlinkSync.bind(fs) : l'alias est ce qui reçoit le résultat de bind.
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === "bind" && ts.isCallExpression(node.parent.parent)) {
    node = node.parent.parent;
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return parent.left.getText();
  return "<valeur>";
}

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
    const member = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    const called = !!node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node;
    if (member && ACCESS_CALLS.has(member) && !called) {
      renamed.push(`${file}:${member} as ${aliasLabel(node as ts.Expression)}`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      !ts.isStringLiteralLike(node.argumentExpression) &&
      FS_OBJECTS.test(node.expression.getText())
    ) {
      renamed.push(`${file}:${node.expression.getText()}[${node.argumentExpression.getText()}]`);
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
