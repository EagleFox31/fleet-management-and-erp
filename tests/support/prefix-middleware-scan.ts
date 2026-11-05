import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, normalize, relative } from "path";
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

/** Lit un module relatif importe ; `undefined` pour une dependance ou un alias non resolu. */
export type ReadModule = (spec: string, fromFile: string) => { file: string; source: string } | undefined;

export function fsModuleReader(root: string): ReadModule {
  return (spec, fromFile) => {
    if (!spec.startsWith(".")) return undefined;
    const base = normalize(join(root, dirname(fromFile), spec));
    for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return { file: relative(root, candidate).replace(/\\/g, "/"), source: readFileSync(candidate, "utf8") };
      }
    }
    return undefined;
  };
}

/** Type declare d'un receveur : `Router`, `express.Router`, `Express`, `Application`, `IRouter` (R6). */
function isReceiverType(type: ts.TypeNode | undefined): boolean {
  if (!type || !ts.isTypeReferenceNode(type)) return false;
  const n = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
  return n === "Router" || n === "Express" || n === "Application" || n === "IRouter";
}

/** Le module exporte-t-il `name` comme routeur (`export const name = Router()` ou type routeur) ? (R4) */
function exportsRouter(source: string, name: string): boolean {
  const sf = ts.createSourceFile("m.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ok = false;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && (isRouterFactory(n.initializer) || isReceiverType(n.type))) ok = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return ok;
}

/** Receveurs et routeurs reconnus a leur declaration, leur type ou leur import, non a leur nom (R4, R6). */
function collectRouters(sf: ts.SourceFile, file: string, read?: ReadModule) {
  const receivers = new Set(RECEIVERS);
  const routers = new Set<string>();
  const factories = new Set<string>();
  const functionLike = (init: ts.Expression | undefined) => !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
  const pre = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && isReceiverType(node.type)) factories.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && functionLike(node.initializer) && isReceiverType((node.initializer as ts.ArrowFunction).type)) factories.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && isReceiverType(node.type)) receivers.add(node.name.text);
    ts.forEachChild(node, pre);
  };
  pre(sf);
  const declare = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      const viaFactory = !!init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && factories.has(init.expression.text);
      if (isRouterFactory(init) || isReceiverType(node.type) || viaFactory) {
        receivers.add(node.name.text);
        routers.add(node.name.text);
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly && ROUTER_MODULE.test(node.moduleSpecifier.text)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) routers.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        // Un import nomme n'est un routeur que si le module l'exporte comme tel (R4).
        const mod = read?.(spec, file);
        for (const el of named.elements) if (mod && exportsRouter(mod.source, (el.propertyName ?? el.name).text)) routers.add(el.name.text);
      }
    }
    ts.forEachChild(node, declare);
  };
  declare(sf);
  return { receivers, routers };
}

export function scanMountedMiddlewares(source: string, file: string, read?: ReadModule): MountedMiddleware[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: MountedMiddleware[] = [];
  const { receivers, routers } = collectRouters(sf, file, read);

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
  const read = fsModuleReader(root);
  return paths.flatMap((path) => {
    const rel = relative(root, path).replace(/\\/g, "/");
    const source = readFileSync(path, "utf8");
    // Filtre peu couteux : un fichier sans `.use(` ni verbe de montage n'est pas analyse.
    return /\.(use|get|post|put|patch|delete|all)\(/.test(source) ? scanMountedMiddlewares(source, rel, read) : [];
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

/** Fichiers ou `routeIdRangeGuard` peut etre monte : fichier -> receveur attendu. */
const ROUTE_ID_GUARD_HOMES: Record<string, string> = { "server/api/index.ts": "apiRouter", "server/app.ts": "app" };

/**
 * `routeIdRangeGuard` (borne des identifiants de route) doit couvrir tout /api : monte dans le routeur
 * (`apiRouter`, sans prefixe) ou dans l'application (`app`, sans prefixe ou sur `/api`), avant le premier
 * montage de routeur de son fichier. Tout autre fichier, receveur ou prefixe est un ecart (R3).
 */
export function routeIdGuardIssues(mounts: MountedMiddleware[], routerMountLines: Record<string, number>): string[] {
  const issues: string[] = [];
  for (const m of mounts.filter((x) => x.name === "routeIdRangeGuard")) {
    const where = `${m.file}:${m.line}`;
    const home = ROUTE_ID_GUARD_HOMES[m.file];
    if (!home) {
      issues.push(`${where} monte dans un fichier non prevu : il doit l'etre dans server/api/index.ts ou server/app.ts`);
      continue;
    }
    if (m.receiver !== home) issues.push(`${where} monte sur ${m.receiver} : il doit l'etre sur ${home}`);
    const allowed = m.prefix === null || m.prefix === "/" || (m.file === "server/app.ts" && m.prefix === "/api");
    if (!allowed) issues.push(`${where} monte sur le prefixe ${JSON.stringify(m.prefix)} : il doit couvrir tout /api`);
    const first = routerMountLines[m.file];
    if (first !== undefined && m.line > first) issues.push(`${where} monte apres le premier routeur (ligne ${first}) : il doit le preceder`);
  }
  return issues;
}

/** Premiere ligne ou un routeur est monte (`x.use("/p", routeur)` ou `registerRoutes(app)`) dans un fichier. */
export function firstRouterMountLine(source: string, file: string, read?: ReadModule): number | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { receivers, routers } = collectRouters(sf, file, read);
  let first: number | undefined;
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const mounted =
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "use" &&
        n.arguments.some((a) => ts.isIdentifier(a) && (routers.has(a.text) || receivers.has(a.text)));
      const registers = ts.isIdentifier(n.expression) && n.expression.text === "registerRoutes";
      if ((mounted || registers) && (first === undefined || at(n) < first)) first = at(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return first;
}

/** Imports interdits d'un fichier, y compris par transitivite des modules relatifs : chaines `a.ts > b.ts > ../db` (R2). */
export function forbiddenImportsDeep(source: string, file: string, read: ReadModule, seen: Set<string> = new Set()): string[] {
  seen.add(file);
  const specs: string[] = [];
  for (const spec of allSpecifiers(source, file)) specs.push(spec);
  const out: string[] = [];
  for (const spec of specs) {
    if (FORBIDDEN_IMPORT.test(spec)) {
      out.push(`${file} > ${spec}`);
      continue;
    }
    const mod = read(spec, file);
    if (mod && !seen.has(mod.file)) for (const chain of forbiddenImportsDeep(mod.source, mod.file, read, seen)) out.push(`${file} > ${chain}`);
  }
  return out;
}

/** Tous les specificateurs charges par un fichier (hors imports de types). */
function allSpecifiers(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) out.push(n.moduleSpecifier.text);
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
      const c = n.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(c) && c.text === "require")) out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Module (chemin relatif a la racine) d'ou `file` importe `name`, `undefined` si non relatif ou introuvable (R2 : `source` reel). */
export function importSourceOf(source: string, file: string, name: string, read: ReadModule): string | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    const c = st.importClause;
    const names = [c.name?.text];
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) names.push(...c.namedBindings.elements.map((e) => e.name.text));
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.push(c.namedBindings.name.text);
    if (names.includes(name)) return read(st.moduleSpecifier.text, file)?.file;
  }
  // Constante locale issue d'une fabrique importee : `const x = createX()` -> module de `createX`.
  let viaFactory: string | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression)) {
      viaFactory ??= importSourceOf(source, file, n.initializer.expression.text, read);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return viaFactory;
}

/** Fonctions anonymes montees : imports interdits (directs ou transitifs) atteints par les identifiants de leur corps (R2). */
export function forbiddenInAnonymousMounts(source: string, file: string, read: ReadModule): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { receivers } = collectRouters(sf, file, read);
  const importOf = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause || st.importClause.isTypeOnly) continue;
    const c = st.importClause;
    const spec = st.moduleSpecifier.text;
    if (c.name) importOf.set(c.name.text, spec);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) importOf.set(e.name.text, spec);
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) importOf.set(c.namedBindings.name.text, spec);
  }
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && receivers.has(n.expression.expression.text)) {
      for (const arg of n.arguments) {
        if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
        const line = sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
        const used = new Set<string>();
        const walk = (x: ts.Node) => {
          if (ts.isIdentifier(x) && importOf.has(x.text)) used.add(x.text);
          ts.forEachChild(x, walk);
        };
        walk(arg);
        for (const id of used) {
          const spec = importOf.get(id)!;
          if (FORBIDDEN_IMPORT.test(spec)) out.push(`${file}:${line} fonction anonyme utilise ${id} (${spec})`);
          else {
            const mod = read(spec, file);
            if (mod) for (const chain of forbiddenImportsDeep(mod.source, mod.file, read)) out.push(`${file}:${line} fonction anonyme utilise ${id} > ${chain}`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
