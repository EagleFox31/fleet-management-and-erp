import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Cycle de vie d'un fichier téléversé (LESSONS_LEARNED, patron de #178, récidive en #348) :
 * toute route de `server/api` qui lit `req.file` / `req.files` lie le sort du fichier à l'écriture
 * qui le référence. Forme exigée, dans le handler de la route :
 *   - un drapeau `let <x> = false` ;
 *   - `<x> = true` après l'écriture ;
 *   - un `finally` dont un `if (!<x> …)` supprime le fichier.
 * Les suppressions écrites refus par refus oublient une sortie (orphelin) ou suppriment le fichier
 * d'une ligne déjà enregistrée (diffusion qui lève après le commit).
 *
 * Liste gelée et stricte : chaque entrée donne sa raison et la condition pour la dégeler.
 */
const LIFECYCLE_FROZEN: Record<string, { reason: string; unfreezeWhen: string }> = {
  "server/api/supplier-invoices.routes.ts:POST /import": {
    reason: "multer.memoryStorage : le classeur reste en mémoire (req.file.buffer), aucun fichier n'est écrit sur le disque",
    unfreezeWhen: "sans objet tant que l'import reste en mémoire ; s'il passe en diskStorage, appliquer le patron et retirer l'entrée",
  },
};

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);

export function scanMulterRoutes(file: string, text: string): { key: string; compliant: boolean }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes: { key: string; compliant: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROUTE_METHODS.has(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      if (readsUploadedFile(node)) {
        routes.push({ key: `${file}:${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`, compliant: hasLifecycleFlag(node) });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return routes;
}

function readsUploadedFile(route: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "file" || node.name.text === "files") &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "req"
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(route);
  return found;
}

/** Drapeaux `let x = false` du handler, assignés à `true`, testés par `if (!x …)` dans un `finally` qui appelle quelque chose. */
function hasLifecycleFlag(route: ts.Node): boolean {
  const declared = new Set<string>();
  const setTrue = new Set<string>();
  const finallyGuards = new Set<string>();
  const negatedFlag = (condition: ts.Expression): string | null => {
    let expr = condition;
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return negatedFlag(expr.left) ?? negatedFlag(expr.right);
    }
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(expr.operand)) {
      return expr.operand.text;
    }
    return null;
  };
  const containsCall = (node: ts.Node): boolean => ts.isCallExpression(node) || !!ts.forEachChild(node, (child) => containsCall(child) || undefined);
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer?.kind === ts.SyntaxKind.FalseKeyword &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Let
    ) {
      declared.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.right.kind === ts.SyntaxKind.TrueKeyword
    ) {
      setTrue.add(node.left.text);
    }
    if (ts.isTryStatement(node) && node.finallyBlock) {
      const scanFinally = (inner: ts.Node) => {
        if (ts.isIfStatement(inner)) {
          const flag = negatedFlag(inner.expression);
          if (flag && containsCall(inner.thenStatement)) finallyGuards.add(flag);
        }
        ts.forEachChild(inner, scanFinally);
      };
      scanFinally(node.finallyBlock);
    }
    ts.forEachChild(node, visit);
  };
  visit(route);
  return [...finallyGuards].some((flag) => declared.has(flag) && setTrue.has(flag));
}

const apiDir = join(process.cwd(), "server", "api");
const routes = readdirSync(apiDir)
  .filter((name) => /\.(ts|js)$/.test(name))
  .flatMap((name) => scanMulterRoutes(`server/api/${name}`, readFileSync(join(apiDir, name), "utf8")));

describe("routes multer de server/api : fichier lié à l'écriture qui le référence (#178, #348)", () => {
  it("le scan voit les routes multer connues (il n'est pas aveugle)", () => {
    const keys = routes.map((r) => r.key);
    for (const key of [
      "server/api/supplier-invoices.routes.ts:POST /:id/settlements",
      "server/api/document-renewals.routes.ts:POST /quick-renew",
      "server/api/vehicle-documents.routes.ts:POST /vehicles/:vehicleId/documents",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("toute route multer suit le patron ou figure dans la liste gelée", () => {
    const offenders = routes.filter((r) => !r.compliant && !(r.key in LIFECYCLE_FROZEN)).map((r) => r.key);
    expect(offenders).toEqual([]);
  });

  it("liste gelée sans entrée morte, chaque entrée justifiée avec sa condition de dégel", () => {
    const live = new Set(routes.filter((r) => !r.compliant).map((r) => r.key));
    expect(Object.keys(LIFECYCLE_FROZEN).filter((key) => !live.has(key))).toEqual([]);
    for (const [key, { reason, unfreezeWhen }] of Object.entries(LIFECYCLE_FROZEN)) {
      expect(reason.length, key).toBeGreaterThan(20);
      expect(unfreezeWhen.length, key).toBeGreaterThan(20);
    }
  });

  it("cas synthétiques : suppression par refus refusée, drapeau + finally accepté", () => {
    const sample = `
      router.post("/a", (req, res, next) => upload(req, res, async () => {
        try { if (!req.body.x) { remove(req.file); return res.sendStatus(400); } await save(req.file); res.sendStatus(201); }
        catch (e) { remove(req.file); next(e); }
      }));
      router.post("/b", (req, res, next) => upload(req, res, async () => {
        let recorded = false;
        try { await save(req.file); recorded = true; res.sendStatus(201); }
        catch (e) { next(e); }
        finally { if (!recorded) remove(req.file); }
      }));
      router.post("/c", (req, res, next) => upload(req, res, async () => {
        let recorded = false;
        try { await save(req.file); res.sendStatus(201); }
        finally { if (!recorded) remove(req.file); }
      }));
      router.get("/d", (req, res) => res.json({}));
    `;
    expect(scanMulterRoutes("s.ts", sample)).toEqual([
      { key: "s.ts:POST /a", compliant: false },
      { key: "s.ts:POST /b", compliant: true },
      { key: "s.ts:POST /c", compliant: false },
    ]);
  });
});
