import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Cycle de vie d'un fichier téléversé (LESSONS_LEARNED, patron de #178, récidive en #348) :
 * toute route de `server/api` (sous-dossiers compris) et de `server/routes.ts` qui reçoit un fichier
 * lie le sort du fichier à l'écriture qui le référence. Forme exigée, dans le handler de la route :
 *   - un drapeau `let <x> = false` ;
 *   - `<x> = true` après l'écriture : au moins un `await` le précède dans le `try`, et tout `await`
 *     qui le suit est un effet au mieux, dans son propre `try`/`catch` ;
 *   - un `finally` dont un `if (!<x> …)` appelle une suppression (`unlink*`, `rm*`, `remove*`,
 *     `deleteFile*`, `deleteUploaded*`).
 * Les suppressions écrites refus par refus oublient une sortie (orphelin) ou suppriment le fichier
 * d'une ligne déjà enregistrée (diffusion qui lève après le commit).
 *
 * Une route reçoit un fichier si elle (ou un handler nommé défini dans le même fichier) lit
 * `req.file` / `req.files` (accès ou déstructuration `const { file } = req`), ou si un de ses
 * arguments est `<x>.single(…)`, `.array(…)`, `.fields(…)` ou `.any()`.
 *
 * Limites connues : un handler importé d'un autre module n'est pas suivi ; un drapeau porté par un
 * objet (`state.ok = true`) n'est pas reconnu ; une écriture synchrone (sans `await`) avant le
 * drapeau n'est pas reconnue comme écriture. Ces cas échouent (faux positif) au lieu de passer.
 *
 * Liste gelée et stricte : chaque entrée donne sa raison et la condition pour la dégeler.
 */
const LIFECYCLE_FROZEN: Record<string, { reason: string; unfreezeWhen: string }> = {
  "server/api/supplier-invoices.routes.ts:POST /import": {
    reason: "multer.memoryStorage : le classeur reste en mémoire (req.file.buffer), aucun fichier n'est écrit sur le disque",
    unfreezeWhen: "sans objet tant que l'import reste en mémoire ; s'il passe en diskStorage, appliquer le patron et retirer l'entrée",
  },
  "server/routes.ts:POST /api/workflows/:sessionId/documents": {
    reason: "multer.memoryStorage : WorkflowDocumentService.saveWorkflowDocument écrit le fichier puis l'INSERT, et le supprime si l'INSERT est refusé",
    unfreezeWhen: "routes.ts est gelé : appliquer le patron quand la route est déplacée dans server/api, puis retirer l'entrée",
  },
};

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use"]);
const MULTER_METHODS = new Set(["single", "array", "fields", "any"]);
const DELETE_NAME = /^(unlink|rm)(Sync)?$|^remove|^deleteFile|^deleteUploaded/;

export type MulterRoute = { key: string; compliant: boolean };

export function scanMulterRoutes(file: string, text: string): MulterRoute[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = namedFunctions(source);
  const routes: MulterRoute[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROUTE_METHODS.has(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const handlers: ts.Node[] = [node];
      for (const arg of node.arguments) {
        if (ts.isIdentifier(arg) && declarations.has(arg.text)) handlers.push(declarations.get(arg.text)!);
      }
      const usesMulter = node.arguments.some(isMulterMiddleware);
      if (usesMulter || handlers.some(readsUploadedFile)) {
        routes.push({ key: `${file}:${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`, compliant: handlers.some(hasLifecycleFlag) });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return routes;
}

/** Fonctions nommées du fichier : `function f() {}` et `const f = (…) => …` / `function`. */
function namedFunctions(source: ts.SourceFile): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isMulterMiddleware(arg: ts.Expression): boolean {
  return ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && MULTER_METHODS.has(arg.expression.name.text);
}

const isReq = (node: ts.Node) => ts.isIdentifier(node) && node.text === "req";
const isFileName = (name: string) => name === "file" || name === "files";

function readsUploadedFile(route: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && isFileName(node.name.text) && isReq(node.expression)) found = true;
    if (ts.isElementAccessExpression(node) && isReq(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && isFileName(node.argumentExpression.text)) {
      found = true;
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isReq(node.initializer)) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if (ts.isIdentifier(name) && isFileName(name.text)) found = true;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(route);
  return found;
}

function collect<T extends ts.Node>(root: ts.Node, test: (node: ts.Node) => node is T): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node) => {
    if (test(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

function negatedFlag(condition: ts.Expression): string | null {
  let expr = condition;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return negatedFlag(expr.left) ?? negatedFlag(expr.right);
  }
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(expr.operand)) {
    return expr.operand.text;
  }
  return null;
}

function callsDeletion(node: ts.Node): boolean {
  return collect(node, ts.isCallExpression).some((call) => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
    return DELETE_NAME.test(name);
  });
}

/** Un `await` après le drapeau est un effet au mieux : un `try` avec `catch` l'entoure, sous le `try` gardé. */
function isBestEffort(awaitNode: ts.Node, guarded: ts.Block): boolean {
  for (let node: ts.Node = awaitNode; node && node !== guarded; node = node.parent) {
    const parent = node.parent;
    if (parent && ts.isTryStatement(parent) && parent.catchClause && parent.tryBlock === node) return true;
  }
  return false;
}

/** Drapeau `let x = false`, chaque `x = true` placé après une écriture, `finally` qui supprime tant que `!x`. */
function hasLifecycleFlag(route: ts.Node): boolean {
  const declared = new Set(
    collect(route, ts.isVariableDeclaration)
      .filter(
        (d) =>
          ts.isIdentifier(d.name) &&
          d.initializer?.kind === ts.SyntaxKind.FalseKeyword &&
          ts.isVariableDeclarationList(d.parent) &&
          (d.parent.flags & ts.NodeFlags.Let) !== 0,
      )
      .map((d) => (d.name as ts.Identifier).text),
  );
  for (const guard of collect(route, ts.isTryStatement)) {
    if (!guard.finallyBlock) continue;
    const flags = collect(guard.finallyBlock, ts.isIfStatement)
      .filter((stmt) => callsDeletion(stmt.thenStatement))
      .map((stmt) => negatedFlag(stmt.expression))
      .filter((flag): flag is string => !!flag && declared.has(flag));
    for (const flag of flags) {
      const sets = collect(
        guard.tryBlock,
        (n): n is ts.BinaryExpression =>
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(n.left) &&
          n.left.text === flag &&
          n.right.kind === ts.SyntaxKind.TrueKeyword,
      );
      if (sets.length === 0) continue;
      const awaits = collect(guard.tryBlock, ts.isAwaitExpression);
      const ordered = sets.every(
        (set) =>
          awaits.some((a) => a.end <= set.getStart()) &&
          awaits.filter((a) => a.getStart() >= set.end).every((a) => isBestEffort(a, guard.tryBlock)),
      );
      if (ordered) return true;
    }
  }
  return false;
}

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|js)$/.test(name) ? [full] : [];
  });
const routes = [...walk(join(root, "server", "api")), join(root, "server", "routes.ts")]
  .map((full) => relative(root, full).split(sep).join("/"))
  .flatMap((file) => scanMulterRoutes(file, readFileSync(join(root, file), "utf8")));

describe("routes multer : fichier lié à l'écriture qui le référence (#178, #348)", () => {
  it("le scan voit les routes multer connues (il n'est pas aveugle)", () => {
    const keys = routes.map((r) => r.key);
    for (const key of [
      "server/api/supplier-invoices.routes.ts:POST /:id/settlements",
      "server/api/document-renewals.routes.ts:POST /quick-renew",
      "server/api/vehicle-documents.routes.ts:POST /vehicles/:vehicleId/documents",
      "server/routes.ts:POST /api/workflows/:sessionId/documents",
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

  it("cas synthétiques : drapeau posé avant l'écriture, finally qui ne supprime rien", () => {
    const sample = `
      router.post("/avant", (req, res) => upload(req, res, async () => {
        let ok = false;
        try { ok = true; await save(req.file); res.sendStatus(201); }
        finally { if (!ok) remove(req.file); }
      }));
      router.post("/entre", (req, res) => upload(req, res, async () => {
        let ok = false;
        try { await check(req.body); ok = true; await save(req.file); res.sendStatus(201); }
        finally { if (!ok) remove(req.file); }
      }));
      router.post("/au-mieux", (req, res) => upload(req, res, async () => {
        let ok = false;
        try { await save(req.file); ok = true; try { await notify(); } catch (e) { log(e); } res.sendStatus(201); }
        finally { if (!ok) remove(req.file); }
      }));
      router.post("/sans-suppression", (req, res) => upload(req, res, async () => {
        let ok = false;
        try { await save(req.file); ok = true; res.sendStatus(201); }
        finally { if (!ok) log("fichier orphelin"); }
      }));
    `;
    expect(scanMulterRoutes("s.ts", sample)).toEqual([
      { key: "s.ts:POST /avant", compliant: false },
      { key: "s.ts:POST /entre", compliant: false },
      { key: "s.ts:POST /au-mieux", compliant: true },
      { key: "s.ts:POST /sans-suppression", compliant: false },
    ]);
  });

  it("cas synthétiques : handler nommé ailleurs, upload.single() et déstructuration", () => {
    const sample = `
      async function nonConforme(req, res) { await save(req.file); res.sendStatus(201); }
      const conforme = async (req, res, next) => {
        let ok = false;
        try { await save(req.file); ok = true; res.sendStatus(201); }
        catch (e) { next(e); }
        finally { if (!ok) fs.unlinkSync(req.file.path); }
      };
      async function deconstruit(req, res) { const { file } = req; await save(file); res.sendStatus(201); }
      async function sansLecture(req, res) { await save(req.body); res.sendStatus(201); }
      router.post("/nomme", guard, upload.single("document"), nonConforme);
      router.post("/nomme-ok", guard, upload.single("document"), conforme);
      router.post("/destructure", guard, deconstruit);
      router.post("/multer-seul", upload.array("photos"), sansLecture);
      router.post("/sans-fichier", guard, sansLecture);
    `;
    expect(scanMulterRoutes("s.ts", sample)).toEqual([
      { key: "s.ts:POST /nomme", compliant: false },
      { key: "s.ts:POST /nomme-ok", compliant: true },
      { key: "s.ts:POST /destructure", compliant: false },
      { key: "s.ts:POST /multer-seul", compliant: false },
    ]);
  });
});
