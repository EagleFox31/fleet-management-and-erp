import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Catch qui maquille une panne en résultat vide : `try { ... } catch { return []; }`.
 * La route répond 200 et l'écran affiche « aucun pneu », « 0 », « valeur 0 » comme de vraies
 * valeurs, sans message ni référence. Incident du 7 novembre 2026 sur /inventory/tires :
 * `getTireStatisticsAdvanced` renvoyait des zéros pendant que le pool de connexions était saturé
 * (`docs/analysis/LESSONS_LEARNED.md`).
 *
 * Détection (AST) dans `server/storage.ts` et `server/services/` : un `catch` sans `throw` qui
 * renvoie une valeur vide :
 * - `[]`, `{}`, `0` ;
 * - un objet dont toutes les propriétés sont vides (`{ tires: [], total: 0 }`), une chaîne qui
 *   commence par « 0 » comptant comme un zéro (`"0"`, `"0mm"`).
 * Les fonctions imbriquées ne sont pas parcourues.
 *
 * Correctif attendu : relancer `new AppError(status, message, { cause })` (`server/lib/app-error.ts`)
 * et journaliser par `moduleLogger`, après avoir vérifié que les appelants traitent l'exception.
 * Les cas existants sont gelés ci-dessous : la liste ne peut que rétrécir.
 */
const KNOWN_EMPTY_ON_ERROR: string[] = [
  "server/services/activity-logger.ts#getEntityLogs",
  "server/services/activity-logger.ts#getUserLogs",
  "server/services/alert-service.ts#emitAlerts",
  "server/services/fleet-statistics-service.ts#getCurrentFleetStatistics",
  "server/services/fleet-statistics-service.ts#getFleetStatusHistory",
  "server/services/fuel-service.ts#getFuelStatistics",
  "server/services/preventive-maintenance-service.ts#checkDateBasedMaintenance",
  "server/services/preventive-maintenance-service.ts#checkMileageBasedMaintenance",
  "server/services/preventive-maintenance-service.ts#getMaintenanceStatistics",
  "server/services/preventive-maintenance-service.ts#getUpcomingMaintenances",
  "server/services/preventive-maintenance-service.ts#getVehicleMaintenanceSchedules",
  "server/services/vehicle-status-service.ts#getFleetKPI",
  "server/services/vehicle-status-service.ts#getFleetStatusAtDate",
  "server/services/vehicle-status-service.ts#getFleetStatusHistory",
  "server/services/vehicle-status-service.ts#getVehicleStatusHistory",
  "server/services/workflow-reminder-service.ts#getActiveWorkflowsForUser",
  "server/services/workflow-reminder-service.ts#getWorkflowStatsForUser",
  "server/storage.ts#getAlertsByUserId",
  "server/storage.ts#getFaultCatalogs",
  "server/storage.ts#getFuelRecordsByVehicleId",
  "server/storage.ts#getMaintenanceCompliance",
  "server/storage.ts#getMaintenanceSchedules",
  "server/storage.ts#getMaintenanceSchedulesByVehicleId",
  "server/storage.ts#getPartRequirements",
  "server/storage.ts#getPartRequirementsByPartId",
  "server/storage.ts#getPartUsageHistory",
  "server/storage.ts#getPartWorkOrders",
  "server/storage.ts#getPartsLowOnStock",
  "server/storage.ts#getPartsStatistics",
  "server/storage.ts#getScheduledMaintenanceCount",
  "server/storage.ts#getStatusHistory",
  "server/storage.ts#getUnreadAlertsByUserId",
  "server/storage.ts#getUsersByRole",
  "server/storage.ts#getVehicleDocuments",
  "server/storage.ts#getVehicleDocumentsByType",
  "server/storage.ts#getVehicles",
  "server/storage.ts#getVehiclesByOwner",
  "server/storage.ts#getWorkOrders",
  "server/storage.ts#getWorkOrdersForTechnician",
];

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

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

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** Valeur qui passerait pour un résultat réel vide : `[]`, `{}`, `0`, `"0…"`, objet de vides. */
function isEmptyValue(raw: ts.Expression): boolean {
  const e = unwrap(raw);
  if (ts.isArrayLiteralExpression(e)) return e.elements.length === 0;
  if (ts.isNumericLiteral(e)) return Number(e.text) === 0;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.startsWith("0");
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((p) => ts.isPropertyAssignment(p) && isEmptyValue(p.initializer));
  }
  return false;
}

/** Noms des fonctions dont un catch renvoie un résultat vide au lieu de relancer. */
export function findEmptyOnError(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && (node as ts.FunctionLikeDeclaration).body) {
      walkOutsideFunctions((node as ts.FunctionLikeDeclaration).body!, (n) => {
        if (!ts.isTryStatement(n) || !n.catchClause) return;
        let rethrows = false;
        let returnsEmpty = false;
        walkOutsideFunctions(n.catchClause.block, (c) => {
          if (ts.isThrowStatement(c)) rethrows = true;
          if (ts.isReturnStatement(c) && c.expression && isEmptyValue(c.expression)) returnsEmpty = true;
        });
        if (returnsEmpty && !rethrows) found.add(functionName(node));
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

describe("catch qui renvoie un résultat vide au lieu de l'erreur", () => {
  const files = [join(repoRoot, "server", "storage.ts"), ...sources(join(repoRoot, "server", "services"))];
  const detected = files
    .flatMap((path) => {
      const rel = relative(repoRoot, path).replace(/\\/g, "/");
      return findEmptyOnError(rel, readFileSync(path, "utf8")).map((name) => `${rel}#${name}`);
    })
    .sort();

  it("aucun nouveau catch ne renvoie [], {} ou des zéros (relancer AppError avec { cause })", () => {
    expect(detected.filter((entry) => !KNOWN_EMPTY_ON_ERROR.includes(entry))).toEqual([]);
  });

  it("cliquet : une entrée gelée qui ne renvoie plus de vide sort de la liste", () => {
    expect(KNOWN_EMPTY_ON_ERROR.filter((entry) => !detected.includes(entry))).toEqual([]);
  });

  it("les pneus n'ont aucune entrée gelée", () => {
    expect(KNOWN_EMPTY_ON_ERROR.filter((entry) => /tire/i.test(entry))).toEqual([]);
  });

  it("le détecteur repère le vide et ignore la relance, le non-trouvé et les valeurs réelles", () => {
    const sample = `
      class S {
        async emptyArray() { try { return await db.select().from(t); } catch (e) { log.error(e); return []; } }
        async emptyPage() { try { return await q(); } catch { return { items: [], total: 0 }; } }
        async zeros() { try { return await q(); } catch { return { count: 0, label: "0mm", nested: { n: 0 } } as Stats; } }
        async zero() { try { return await q(); } catch { return 0; } }
        async rethrows() { try { return await q(); } catch (e) { log.error(e); throw new AppError(500, "x", { cause: e }); } }
        async notFound() { try { return await q(); } catch { return undefined; } }
        async realValue() { try { return await q(); } catch (e) { return { success: false, error: "x" }; } }
        async nested() { try { return await q(); } catch (e) { const f = () => { throw e; }; return []; } }
        async inner() { try { return await q(); } catch (e) { return list.map(() => { return []; }); } }
      }
      export const arrow = async () => { try { return await q(); } catch { return {}; } };
    `;
    expect(findEmptyOnError("sample.ts", sample).sort()).toEqual(["arrow", "emptyArray", "emptyPage", "nested", "zero", "zeros"]);
  });
});
