import ts from "typescript";

/**
 * Recense les écritures d'alerte côté serveur et dit si chacune émet `alert_created` (couche 2 de
 * AGENTS.md §2) : sans trame, la cloche d'un autre profil ne bouge qu'au prochain polling.
 *
 * Écriture d'alerte : `insert(alerts)` (Drizzle, `schema.alerts` compris), `createAlert(…)` (storage)
 * ou `INSERT INTO alerts` en SQL brut.
 *
 * Portée d'une écriture : la fonction nommée qui l'englobe (déclaration, méthode, variable ou
 * propriété qui reçoit une fonction), ou le gestionnaire de route `METHODE /chemin`. Un rappel
 * anonyme (`.map(async …)`) remonte jusqu'à elle.
 *
 * Émission : dans cette portée, un appel à `broadcastAlertCreated(…)`, la chaîne `"alert_created"`,
 * ou l'appel d'une fonction du même fichier qui contient l'un des deux (un niveau).
 */

export type AlertWriteSite = { file: string; scope: string; line: number; emits: boolean };

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);
const EMIT_MARKER = /\bbroadcastAlertCreated\s*\(|["'`]alert_created["'`]/;
const RAW_SQL_INSERT = /\bINSERT\s+INTO\s+"?alerts"?(?![\w"])/i;

function isAlertsIdentifier(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === "alerts";
  return ts.isPropertyAccessExpression(node) && node.name.text === "alerts";
}

function isAlertWrite(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
    if (name === "insert" && node.arguments.length === 1 && isAlertsIdentifier(node.arguments[0])) return true;
    if (name === "createAlert") return true;
    return false;
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return RAW_SQL_INSERT.test(node.getText());
  return false;
}

/** Portée nommée qui englobe `node` (fonction nommée ou `METHODE /chemin`). Partagée avec `file-access-scan`. */
export function scopeOf(node: ts.Node): { name: string; node: ts.Node } | null {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return { name: current.name.text, node: current };
    if (ts.isMethodDeclaration(current) && (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name))) {
      return { name: current.name.text, node: current };
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return { name: parent.name.text, node: current };
      if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) {
        return { name: parent.name.text, node: current };
      }
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
        const method = parent.expression.name.text;
        const [first] = parent.arguments;
        if (ROUTE_METHODS.has(method) && first && ts.isStringLiteralLike(first)) {
          return { name: `${method.toUpperCase()} ${first.text}`, node: current };
        }
      }
      if (ts.isFunctionExpression(current) && current.name) return { name: current.name.text, node: current };
    }
  }
  return null;
}

/** Noms des fonctions du fichier dont le corps émet (pour l'appel indirect, un niveau). */
function localEmitters(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionLike(node) && "body" in node && node.body) || ts.isArrowFunction(node)) {
      const scope = ts.isFunctionDeclaration(node) && node.name ? node.name.text : null;
      const parent = node.parent;
      const name = scope ?? (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null);
      if (name && EMIT_MARKER.test(node.getText(source))) names.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function emitsWithin(text: string, emitters: Set<string>, self: string): boolean {
  if (EMIT_MARKER.test(text)) return true;
  for (const name of emitters) {
    if (name !== self && new RegExp(String.raw`\b${name}\s*\(`).test(text)) return true;
  }
  return false;
}

export function scanAlertWrites(file: string, text: string): AlertWriteSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const emitters = localEmitters(source);
  const sites: AlertWriteSite[] = [];
  const visit = (node: ts.Node) => {
    if (isAlertWrite(node)) {
      const scope = scopeOf(node);
      const scopeText = (scope?.node ?? source).getText(source);
      const name = scope?.name ?? "<module>";
      sites.push({
        file,
        scope: name,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        emits: emitsWithin(scopeText, emitters, name),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** Clé stable d'une portée (`fichier:portée`), insensible aux numéros de ligne. */
export const siteKey = (site: Pick<AlertWriteSite, "file" | "scope">) => `${site.file}:${site.scope}`;
