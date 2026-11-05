import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { CLIENT_BILLING_EVENT_ROLES, CLIENT_BILLING_STATS_ROLES, MISSION_BUDGET_READ_ROLES } from "../../../shared/constants/roles";

/**
 * Montants du budget d'une mission (Q19) : `estimatedFuelCost` et `workflowData.budgetPlan` sont réservés à
 * `MISSION_BUDGET_READ_ROLES`.
 *
 * Toute requête qui lit la table `missions` sans projection explicite (`select()` vide, `{ mission: missions }`,
 * `getTableColumns(missions)`) ramène ces colonnes. Si le résultat atteint une réponse HTTP ou une trame temps
 * réel lue par un technicien ou un chauffeur, le montant fuit : c'est arrivé par `/api/operations/*`, qui
 * renvoyait la ligne entière alors que `/api/missions` la masquait déjà.
 *
 * Les occurrences existantes sont gelées ci-dessous, chacune avec sa justification (masquée en aval par
 * `redactMissionBudget` / `omitMissionBudget`, servie à des lecteurs du budget seulement, ou jamais servie).
 * La liste doit rester strictement égale :
 * - une occurrence nouvelle fait échouer le test : préférer une projection explicite, sinon masquer la sortie
 *   puis ajouter l'entrée ici avec sa justification ;
 * - une occurrence supprimée fait aussi échouer le test : retirer l'entrée.
 */
const FROZEN: Record<string, string> = {
  "server/api/missions.routes.ts#1": "ajout d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  "server/api/missions.routes.ts#2": "retrait d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  "server/services/client-billing-service.ts#1": "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  "server/services/client-billing-service.ts#2": "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  "server/services/client-billing-service.ts#3": "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  "server/services/excel-export-service.ts#1": "export missions : colonnes écrites une à une, aucun montant du budget (vérifié ci-dessous)",
  "server/services/excel-export-service.ts#2": "export factures : colonnes écrites une à une, aucun montant du budget (vérifié ci-dessous)",
  "server/services/management-dashboard-service.ts#1": "tableau de direction : /api/management réservé à isManagementOrAdmin, lecteurs du budget",
  "server/services/management-dashboard-service.ts#2": "tableau de direction : /api/management réservé à isManagementOrAdmin, lecteurs du budget",
  "server/services/operations-service.ts#1": "missions d'un client : GET /api/operations/missions/by-client masque par redactMissionBudget",
  "server/services/operations-service.ts#2": "statistiques par destination : GET /api/operations/stats/by-destination masque par redactMissionBudget",
  "server/services/operations-service.ts#3": "liste des missions : GET /api/operations/missions masque par redactMissionBudget",
  "server/services/operations-service.ts#4": "coûts d'une mission : seuls le coût carburant réel et le coût véhicule sont renvoyés",
};

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverDir = join(root, "server");

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Argument équilibré du `.select(` qui précède la position donnée, ou null s'il n'y en a pas. */
function selectArgument(source: string, position: number): string | null {
  const start = source.lastIndexOf(".select(", position);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + ".select".length; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(start + ".select(".length, i);
    }
  }
  return null;
}

function isWholeRow(argument: string): boolean {
  return argument.trim() === "" || /:\s*missions\s*[,}\n]/.test(argument) || /getTableColumns\(\s*missions\s*\)/.test(argument);
}

function findWholeMissionReads(source: string, key: string): string[] {
  const found: string[] = [];
  const fromMissions = /\.(?:from|leftJoin|innerJoin|rightJoin)\(\s*missions\b/g;
  let ordinal = 0;
  for (let match = fromMissions.exec(source); match; match = fromMissions.exec(source)) {
    const argument = selectArgument(source, match.index);
    if (argument !== null && isWholeRow(argument)) found.push(`${key}#${++ordinal}`);
  }
  return found;
}

const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

describe("lectures entières de la table missions (montants du budget, Q19)", () => {
  const found = serverSources(serverDir).flatMap((path) => {
    const key = relative(root, path).replace(/\\/g, "/");
    return findWholeMissionReads(readFileSync(path, "utf8"), key);
  });

  it("aucune occurrence hors de la liste gelée, et aucune entrée périmée", () => {
    expect([...found].sort()).toEqual(Object.keys(FROZEN).sort());
  });

  it("chaque entrée gelée porte une justification", () => {
    for (const [entry, reason] of Object.entries(FROZEN)) expect(reason.length, entry).toBeGreaterThan(15);
  });

  it("/api/operations : chaque réponse de mission ou de statistique passe par redactMissionBudget, la trame par omitMissionBudget", () => {
    const src = read("server/api/operations.routes.ts");
    for (const path of ["/missions/from-fuel", "/missions/upcoming", "/missions/active", "/missions\"", "/missions/by-client/:clientName", "/stats/by-client", "/stats/by-destination"]) {
      const start = src.indexOf(`"${path.replace(/"$/, "")}"`);
      expect(start, path).toBeGreaterThan(-1);
      const handler = src.slice(start, src.indexOf("\n});", start));
      expect(handler, path).toMatch(/res\.json\(redactMissionBudget\(req\.user, /);
    }
    expect(src).toContain("payload: omitMissionBudget(payload),");
  });

  it("justifications vérifiables : facturation réservée aux lecteurs du budget, export sans montant du budget", () => {
    for (const role of [...CLIENT_BILLING_EVENT_ROLES, ...CLIENT_BILLING_STATS_ROLES]) {
      expect(MISSION_BUDGET_READ_ROLES as readonly string[], role).toContain(role);
    }
    expect(read("server/services/excel-export-service.ts")).not.toMatch(/estimatedFuelCost|budgetPlan/);
    expect(read("server/api/management.routes.ts")).not.toMatch(/router\.get\([^)]*authenticate, (?!isManagementOrAdmin)/);
  });

  it("le détecteur repère une lecture entière et ignore une projection explicite", () => {
    expect(findWholeMissionReads("const r = await db.select().from(missions).where(x);", "f")).toEqual(["f#1"]);
    expect(findWholeMissionReads("db.select({ mission: missions, id: a.id }).from(a).leftJoin(missions, eq(1, 1));", "f")).toEqual(["f#1"]);
    expect(findWholeMissionReads("db.select(getTableColumns(missions)).from(missions);", "f")).toEqual(["f#1"]);
    expect(findWholeMissionReads("db.select({ id: missions.id, status: missions.status }).from(missions);", "f")).toEqual([]);
  });
});
