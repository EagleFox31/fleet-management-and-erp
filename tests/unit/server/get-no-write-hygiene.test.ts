import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Aucune écriture dans une route GET. Le cookie de session est en SameSite=None sans jeton CSRF :
 * une écriture déclenchée par un GET (ou par un formulaire) peut l'être depuis n'importe quel site
 * ouvert dans le navigateur du chauffeur. Near miss du 10 novembre 2026 : `GET /api/driver/positions`
 * (relevé OsmAnd en requête) déposait une position (audit sécurité de #660). Règle : AGENTS.md §10,
 * « toute route qui écrit attend du JSON, jamais d'écriture en GET ».
 *
 * Détection (AST) dans `server/api/` : un `router.get(...)` dont le gestionnaire (en ligne, enveloppé,
 * ou déclaré en `const` dans le même fichier) appelle `.insert(` / `.update(` / `.delete(`, ou une
 * fonction nommée `ingest*` ou `create*`. Un service importé qui écrit sous un autre nom n'est pas
 * vu : le motif reste à proscrire. Liste gelée vide : elle ne doit plus grossir.
 */
const KNOWN_GET_WRITES: string[] = [];

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const apiDir = join(repoRoot, "server", "api");
const WRITE_METHODS = new Set(["insert", "update", "delete"]);
const WRITE_NAME = /^(ingest|create)[A-Z0-9_]/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Contenu des déclarations `const nom = ...` du fichier, pour suivre un gestionnaire nommé. */
function topLevelConsts(source: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) out.set(decl.name.text, decl.initializer);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.set(statement.name.text, statement);
    }
  }
  return out;
}

function writesIn(node: ts.Node, consts: Map<string, ts.Node>, seen: Set<string>): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && WRITE_METHODS.has(callee.name.text)) found.push(`.${callee.name.text}(`);
      else if (ts.isIdentifier(callee) && WRITE_NAME.test(callee.text)) found.push(`${callee.text}(`);
      else if (ts.isPropertyAccessExpression(callee) && WRITE_NAME.test(callee.name.text)) found.push(`${callee.name.text}(`);
    }
    // Un gestionnaire nommé (ou une fonction locale appelée) est suivi dans le fichier.
    if (ts.isIdentifier(n) && consts.has(n.text) && !seen.has(n.text)) {
      seen.add(n.text);
      found.push(...writesIn(consts.get(n.text)!, consts, seen));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function violations(): string[] {
  const out: string[] = [];
  for (const file of files(apiDir)) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const consts = topLevelConsts(source);
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "get" &&
        ts.isIdentifier(n.expression.expression) &&
        /router$/i.test(n.expression.expression.text)
      ) {
        const [path, ...handlers] = n.arguments;
        const label = path && ts.isStringLiteralLike(path) ? path.text : "?";
        const writes = handlers.flatMap((h) => writesIn(h, consts, new Set()));
        if (writes.length > 0) out.push(`${relative(repoRoot, file).replace(/\\/g, "/")} GET ${label}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return out.sort();
}

describe("aucune écriture dans une route GET (server/api)", () => {
  it("ne dépasse pas la liste gelée", () => {
    expect(violations().filter((v) => !KNOWN_GET_WRITES.includes(v))).toEqual([]);
  });

  it("la liste gelée ne garde pas d'entrée corrigée", () => {
    const current = violations();
    expect(KNOWN_GET_WRITES.filter((v) => !current.includes(v))).toEqual([]);
  });

  it("le détecteur voit un GET qui écrit (garde de la garde)", () => {
    const sample = ts.createSourceFile(
      "x.ts",
      'const h = async (req, res) => { await ingestDriverPositions(); };\nrouter.get("/p", authorize(["driver"]), h);\nrouter.get("/q", async (req, res) => { await db.insert(t).values({}); });\nrouter.get("/ok", async (req, res) => { await db.select().from(t); });',
      ts.ScriptTarget.Latest,
      true,
    );
    const consts = topLevelConsts(sample);
    const hits: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "get") {
        const [path, ...handlers] = n.arguments;
        if (handlers.flatMap((h) => writesIn(h, consts, new Set())).length > 0) hits.push((path as ts.StringLiteral).text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sample);
    expect(hits).toEqual(["/p", "/q"]);
  });
});
