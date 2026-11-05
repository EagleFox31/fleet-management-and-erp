import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Catch qui avale une écriture : `try { db.delete(...) } catch { console.error(...); return false; }`.
 * La route ne voit qu'un booléen et répond 2xx. Deux défauts du 5 novembre 2026 venaient de ce
 * motif : `removePartFromWorkOrder` (id inconnu ou erreur → 204) et `deleteWorkOrder` (refus de
 * FK compté en simple échec).
 *
 * Détection (AST) dans `server/storage.ts` et `server/services/` : un `try` dont le bloc écrit en
 * base (`.insert(`, `.update(`, `.delete(`) et dont le `catch` renvoie `false`, `null`,
 * `undefined` ou rien, sans aucun `throw`. Les fonctions imbriquées ne sont pas parcourues.
 *
 * Limite assumée : une écriture déléguée à un helper (`this.recordStockMovement(...)` seul dans le
 * `try`) n'est pas vue. Le motif reste à proscrire.
 *
 * Correctif attendu : relancer `new AppError(status, message, { cause })` (`server/lib/app-error.ts`)
 * et journaliser par `moduleLogger`. Les cas existants sont gelés ci-dessous : la liste ne peut que
 * rétrécir.
 */
const KNOWN_SWALLOWING = [
  "server/services/documentStorage.ts#deleteVehicleDocument",
  "server/services/documentStorage.ts#updateVehicleDocument",
  "server/services/part-requirements-service.ts#deletePartRequirement",
  "server/services/preventive-maintenance-service.ts#completeMaintenanceAndScheduleNext",
  "server/services/preventive-maintenance-service.ts#createDateBasedWorkOrder",
  "server/services/preventive-maintenance-service.ts#deactivateSchedule",
  "server/services/preventive-maintenance-service.ts#reactivateSchedule",
  "server/services/tires-service-simplified.ts#updateVehicleTire",
  "server/storage.ts#deleteAlert",
  "server/storage.ts#deleteFaultCatalog",
  "server/storage.ts#deleteMaintenanceSchedule",
  "server/storage.ts#deletePartRequirement",
  "server/storage.ts#deleteVehicle",
  "server/storage.ts#deleteWorkOrder",
  "server/storage.ts#markAlertAsRead",
  "server/storage.ts#updatePartRequirement",
  "server/storage.ts#updatePartUsed",
  "server/storage.ts#updateVehicleDocument",
];

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const WRITE = /\.(insert|update|delete)\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function walkOutsideFunctions(node: ts.Node, visit: (n: ts.Node) => void) {
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionLike(child)) return;
    visit(child);
    walkOutsideFunctions(child, visit);
  });
}

function functionName(fn: ts.Node): string {
  const named = fn as ts.Node & { name?: ts.Node };
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  const parent = fn.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return "<anonyme>";
}

function swallowsEmpty(ret: ts.ReturnStatement): boolean {
  const e = ret.expression;
  return !e || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined");
}

/** Noms des fonctions dont un catch avale une écriture en base. */
function findSwallowingWrites(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && (node as ts.FunctionLikeDeclaration).body) {
      walkOutsideFunctions((node as ts.FunctionLikeDeclaration).body!, (n) => {
        if (!ts.isTryStatement(n) || !n.catchClause || !WRITE.test(n.tryBlock.getText(source))) return;
        let rethrows = false;
        let swallows = false;
        walkOutsideFunctions(n.catchClause.block, (c) => {
          if (ts.isThrowStatement(c)) rethrows = true;
          if (ts.isReturnStatement(c) && swallowsEmpty(c)) swallows = true;
        });
        if (swallows && !rethrows) found.add(functionName(node));
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

describe("catch qui avale une écriture en base", () => {
  const files = [join(repoRoot, "server", "storage.ts"), ...sources(join(repoRoot, "server", "services"))];
  const detected = files
    .flatMap((path) => {
      const rel = relative(repoRoot, path).replace(/\\/g, "/");
      return findSwallowingWrites(rel, readFileSync(path, "utf8")).map((name) => `${rel}#${name}`);
    })
    .sort();

  it("aucun nouveau catch n'avale une écriture (relancer AppError avec { cause })", () => {
    expect(detected.filter((entry) => !KNOWN_SWALLOWING.includes(entry))).toEqual([]);
  });

  it("cliquet : une entrée gelée qui n'avale plus sort de la liste", () => {
    expect(KNOWN_SWALLOWING.filter((entry) => !detected.includes(entry))).toEqual([]);
  });

  it("le détecteur repère l'avalement et ignore la relance ou la lecture", () => {
    const sample = `
      class S {
        async swallowFalse(id: number) { try { await db.delete(t).where(id); return true; } catch (e) { console.error(e); return false; } }
        async swallowVoid() { try { await db.update(t).set({}); } catch { return; } }
        async rethrows() { try { await db.insert(t).values({}); return true; } catch (e) { log.error(e); throw new AppError(500, "x", { cause: e }); } }
        async readOnly() { try { return await db.select().from(t); } catch { return null; } }
        async nested() { try { await db.delete(t); } catch (e) { const f = () => { throw e; }; return null; } }
      }
      export const arrow = async () => { try { await db.update(t).set({}); } catch { return undefined; } };
    `;
    expect(findSwallowingWrites("sample.ts", sample).sort()).toEqual(["arrow", "nested", "swallowFalse", "swallowVoid"]);
  });
});
