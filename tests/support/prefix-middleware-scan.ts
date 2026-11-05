import { readFileSync } from "fs";
import { relative } from "path";
import ts from "typescript";

/**
 * Recensement statique (AST TypeScript) des middlewares montes sur un prefixe ou sur toute
 * l'application : `app.use(...)`, `apiRouter.use(...)`, `router.use(...)`, ainsi que les chaines de
 * middlewares des verbes (`apiRouter.post("/auth/login", a, b)`) dans les deux fichiers de montage.
 *
 * Un middleware monte ainsi s'execute AVANT les gardes de role des routes qu'il precede : il doit
 * etre inscrit et justifie dans `tests/unit/server/prefix-middleware-guardrail.test.ts`.
 * Fonction pure sur du texte : aucune base, aucun import du code serveur.
 */

export interface MountedMiddleware {
  /** Chemin relatif a la racine du depot, separateurs `/`. */
  file: string;
  line: number;
  receiver: string;
  /** `use` ou nom du verbe HTTP. */
  method: string;
  /** Prefixe litteral du montage, `null` si le montage couvre tout. */
  prefix: string | null;
  /** Nom du middleware : identifiant, appelant (`auditWrites`), `a.b`, ou `(anonyme)@<prefixe>`. */
  name: string;
}

const RECEIVERS = new Set(["app", "apiRouter", "router"]);
const VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);
/** Fichiers ou les verbes portent des chaines de middlewares (et non des routes metier). */
const VERB_FILES = /(^|\/)server\/(app\.ts|api\/index\.ts)$/;
/** Les routeurs montes ne sont pas des middlewares : ils portent leurs propres gardes. */
const ROUTER_NAME = /(Routes?|Router)$/;

function calleeName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${calleeName(node.expression)}.${node.name.text}`;
  if (ts.isCallExpression(node)) return calleeName(node.expression);
  return node.getText();
}

function prefixOf(arg: ts.Expression | undefined): string | null {
  if (!arg) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isRegularExpressionLiteral(arg)) return arg.text;
  if (ts.isArrayLiteralExpression(arg)) return arg.elements.map((e) => prefixOf(e) ?? e.getText()).join("|");
  return null;
}

function isPathArg(arg: ts.Expression): boolean {
  return ts.isStringLiteralLike(arg) || ts.isRegularExpressionLiteral(arg) || ts.isArrayLiteralExpression(arg);
}

export function scanMountedMiddlewares(source: string, file: string): MountedMiddleware[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: MountedMiddleware[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const method = node.expression.name.text;
      const isUse = method === "use";
      const isVerb = VERBS.has(method) && VERB_FILES.test(file);
      if (ts.isIdentifier(receiver) && RECEIVERS.has(receiver.text) && (isUse || isVerb)) {
        const args = [...node.arguments];
        const prefix = args.length > 0 && isPathArg(args[0]) ? prefixOf(args.shift()) : null;
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        for (const raw of args) {
          const arg = ts.isSpreadElement(raw) ? raw.expression : raw;
          let name: string;
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) name = `(anonyme)@${prefix ?? "*"}`;
          else if (ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg) || ts.isCallExpression(arg)) {
            name = calleeName(arg);
            if (ROUTER_NAME.test(name.split(".").pop() ?? name) || name === "registerRoutes") continue;
          } else name = arg.getText();
          found.push({ file, line, receiver: receiver.text, method, prefix, name });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function scanFiles(paths: string[], root: string): MountedMiddleware[] {
  return paths.flatMap((path) => {
    const rel = relative(root, path).replace(/\\/g, "/");
    const source = readFileSync(path, "utf8");
    // Filtre peu couteux : un fichier sans `.use(` ni verbe de montage n'est pas analyse.
    return /\.(use|get|post|put|patch|delete|all)\(/.test(source) ? scanMountedMiddlewares(source, rel) : [];
  });
}
