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

/** Receveurs connus d'avance (parametres de fonction) ; les autres sont decouverts par leur declaration (R6). */
const RECEIVERS = new Set(["app", "apiRouter", "router"]);
const VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);
/** Fichiers ou les verbes portent des chaines de middlewares (et non des routes metier). */
const VERB_FILES = /(^|\/)server\/(app\.ts|api\/index\.ts)$/;
/** Module importe qui exporte un routeur : `./x.routes`, `./routes`, `../api/x.router`. */
const ROUTER_MODULE = /(^|[./-])(routes?|router)$/;

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

/** `Router()` ou `express.Router()` ou `express()` : creation d'un receveur de montage. */
function isRouterFactory(init: ts.Expression | undefined): boolean {
  if (!init || !ts.isCallExpression(init)) return false;
  const name = calleeName(init.expression);
  return name === "Router" || name === "express.Router" || name === "express";
}

export function scanMountedMiddlewares(source: string, file: string): MountedMiddleware[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: MountedMiddleware[] = [];

  // Receveurs et routeurs identifies par leur declaration, non par leur nom (R4, R6).
  const receivers = new Set(RECEIVERS);
  const routers = new Set<string>();
  const declare = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isRouterFactory(node.initializer)) {
      receivers.add(node.name.text);
      routers.add(node.name.text);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ROUTER_MODULE.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause?.name) routers.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const el of named.elements) routers.add(el.name.text);
    }
    ts.forEachChild(node, declare);
  };
  declare(sf);

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const method = node.expression.name.text;
      const isUse = method === "use";
      const isVerb = VERBS.has(method) && VERB_FILES.test(file);
      if (ts.isIdentifier(receiver) && receivers.has(receiver.text) && (isUse || isVerb)) {
        const args = [...node.arguments];
        const prefix = args.length > 0 && isPathArg(args[0]) ? prefixOf(args.shift()) : null;
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        for (const raw of args) {
          const arg = ts.isSpreadElement(raw) ? raw.expression : raw;
          let name: string;
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) name = `(anonyme)@${prefix ?? "*"}`;
          else if (ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg) || ts.isCallExpression(arg)) {
            name = calleeName(arg);
            // Un routeur monte porte ses propres gardes. Il se reconnait a sa declaration ou a son import, pas a son nom.
            if (ts.isIdentifier(arg) && (routers.has(arg.text) || receivers.has(arg.text) || arg.text === "registerRoutes")) continue;
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

/** Derogations (nom + fichier) sans montage reel : elles ont ete corrigees et doivent sortir de la liste (R1). */
export function staleDerogations(derogations: Array<{ name: string; file: string }>, mounts: MountedMiddleware[]): string[] {
  return derogations.filter((d) => !mounts.some((m) => m.name === d.name && m.file === d.file)).map((d) => `${d.file} ${d.name}`);
}

/** Imports interdits a un middleware « sans base » : base, stockage, services, ORM, pilotes. */
const FORBIDDEN_IMPORT = /(^|\/)(db|storage)(\.[jt]s)?$|\/services\/|^(drizzle-orm|@neondatabase\/serverless|pg|postgres)(\/|$)/;

/** Specificateurs interdits d'un fichier : import statique, re-export, `import()` et `require()` (R2). Les imports de types sont ignores. */
export function forbiddenImports(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const check = (spec: string) => FORBIDDEN_IMPORT.test(spec) && out.push(spec);
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) check(n.moduleSpecifier.text);
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) check(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) check(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * `routeIdRangeGuard` (borne des identifiants de route) doit couvrir tout le routeur /api : monte sans
 * prefixe, sur `apiRouter`, avant le premier montage de routeur. Retourne les ecarts (R3).
 */
export function routeIdGuardIssues(mounts: MountedMiddleware[], routerMountLines: Record<string, number>): string[] {
  const issues: string[] = [];
  for (const m of mounts.filter((x) => x.name === "routeIdRangeGuard")) {
    const where = `${m.file}:${m.line}`;
    if (m.prefix !== null && m.prefix !== "/") issues.push(`${where} monte sur le prefixe ${JSON.stringify(m.prefix)} : il doit couvrir tout /api`);
    if (m.receiver !== "apiRouter" && m.receiver !== "app") issues.push(`${where} monte sur ${m.receiver} : il doit l'etre sur apiRouter`);
    const first = routerMountLines[m.file];
    if (first !== undefined && m.line > first) issues.push(`${where} monte apres le premier routeur (ligne ${first}) : il doit le preceder`);
  }
  return issues;
}

/** Premiere ligne ou un routeur est monte (`x.use("/p", routeur)`) dans un fichier, pour `routeIdGuardIssues`. */
export function firstRouterMountLine(source: string, file: string): number | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routers = new Set<string>();
  const collect = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && ROUTER_MODULE.test(n.moduleSpecifier.text) && n.importClause?.name) routers.add(n.importClause.name.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  let first: number | undefined;
  const visit = (n: ts.Node) => {
    if (first === undefined && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "use") {
      if (n.arguments.some((a) => ts.isIdentifier(a) && routers.has(a.text))) first = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return first;
}
