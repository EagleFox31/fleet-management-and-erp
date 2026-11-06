import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { CLIENT_BILLING_EVENT_ROLES, CLIENT_BILLING_STATS_ROLES, MISSION_BUDGET_READ_ROLES, MISSION_MANAGER_ROLES } from "../../../shared/constants/roles";

/**
 * Montants du budget d'une mission (Q19) : `estimatedFuelCost` et `workflowData.budgetPlan` sont réservés à
 * `MISSION_BUDGET_READ_ROLES`.
 *
 * Toute requête qui lit la table `missions` sans projection explicite (`select()` vide, `{ mission: missions }`,
 * `getTableColumns(missions)`) ramène ces colonnes, comme toute écriture `insert` / `update` suivie d'un
 * `.returning()` sans argument. Si le résultat atteint une réponse HTTP ou une trame temps réel lue par un
 * technicien ou un chauffeur, le montant fuit : c'est arrivé par `/api/operations/*`, qui renvoyait la ligne
 * entière alors que `/api/missions` la masquait déjà.
 *
 * Les occurrences existantes sont gelées ci-dessous, chacune avec sa justification (masquée en aval par
 * `redactMissionBudget` / `omitMissionBudget`, servie à des lecteurs du budget seulement, ou jamais servie).
 * La clé nomme le bloc englobant (route, méthode, fonction), pas le rang dans le fichier : une lecture qui
 * change de bloc change de clé, même si leur nombre ne bouge pas. La liste doit rester strictement égale :
 * - une occurrence nouvelle fait échouer le test : préférer une projection explicite, sinon masquer la sortie
 *   puis ajouter l'entrée ici avec sa justification ;
 * - une occurrence supprimée fait aussi échouer le test : retirer l'entrée.
 */
const MR = "server/api/missions.routes.ts ›";
const BILLING = "server/services/client-billing-service.ts ›";
const OPS = "server/services/operations-service.ts ›";
const DASHBOARD = "server/services/management-dashboard-service.ts ›";
const EXPORT = "server/services/excel-export-service.ts ›";
const FROZEN: Record<string, string> = {
  [`${MR} POST /:id/assignments (lecture)`]: "ajout d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  [`${MR} POST /:id/assignments (update returning)`]: "ajout d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  [`${MR} DELETE /:id/assignments/:assignmentId (lecture)`]: "retrait d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  [`${MR} DELETE /:id/assignments/:assignmentId (update returning)`]: "retrait d'affectation : la mission ne part qu'en trame, par broadcastMissionUpdate (omitMissionBudget)",
  [`${MR} POST / (insert returning)`]: "création : route réservée à MISSION_MANAGER_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  [`${MR} PATCH /:id (update returning)`]: "correction : route réservée à MISSION_MANAGER_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  [`${MR} PUT /:id/status (update returning)`]: "changement de statut : réponse par redactMissionBudget, trame par broadcastMissionUpdate (vérifié ci-dessous)",
  [`${BILLING} generateInvoiceFromMission (lecture)`]: "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  [`${BILLING} getClientInvoices (lecture)`]: "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  [`${BILLING} getInvoiceById (lecture)`]: "facturation : routes /api/billing réservées à CLIENT_BILLING_*_ROLES, tous lecteurs du budget (vérifié ci-dessous)",
  [`${EXPORT} exportClientOperations (lecture)`]: "export missions : colonnes écrites une à une, aucun montant du budget (vérifié ci-dessous)",
  [`${EXPORT} exportClientInvoices (lecture)`]: "export factures : colonnes écrites une à une, aucun montant du budget (vérifié ci-dessous)",
  [`${DASHBOARD} aggregateMissionProfitability (lecture)`]: "tableau de direction : /api/management réservé à isManagementOrAdmin, lecteurs du budget",
  [`${DASHBOARD} aggregatePeriodMetrics (lecture)`]: "tableau de direction : /api/management réservé à isManagementOrAdmin, lecteurs du budget",
  [`${OPS} getMissionsByClient (lecture)`]: "missions d'un client : GET /api/operations/missions/by-client masque par redactMissionBudget",
  [`${OPS} getStatsByDestination (lecture)`]: "statistiques par destination : GET /api/operations/stats/by-destination masque par redactMissionBudget",
  [`${OPS} getAllMissions (lecture)`]: "liste des missions : GET /api/operations/missions masque par redactMissionBudget",
  [`${OPS} calculateMissionCosts (lecture)`]: "coûts d'une mission : seuls le coût carburant réel et le coût véhicule sont renvoyés",
  [`${OPS} createMissionFromFuel (insert returning)`]: "mission depuis un plein : POST /api/operations/missions/from-fuel masque par redactMissionBudget",
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

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "await"]);

/**
 * Bloc qui contient la position : route Express (`POST /:id`), méthode de classe, fonction ou constante de
 * premier niveau, selon la déclaration la plus proche en amont. Une clé gelée par bloc, pas par rang dans le
 * fichier : déplacer une lecture d'une fonction à l'autre change sa clé, même si leur nombre ne bouge pas.
 */
function enclosingBlock(source: string, position: number): string {
  const anchor = /\b(?:router|app)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)|(?:^|\n)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|(?:^|\n)(?:export\s+)?(?:const|let)\s+(\w+)\s*=|\n {2}(?:(?:public|private|protected|static)\s+)*(?:async\s+)?(\w+)\s*\(/g;
  let block = "(module)";
  for (let match = anchor.exec(source); match && match.index < position; match = anchor.exec(source)) {
    if (match[1]) block = `${match[1].toUpperCase()} ${match[2]}`;
    else if (match[3] ?? match[4]) block = (match[3] ?? match[4])!;
    else if (match[5] && !KEYWORDS.has(match[5])) block = match[5];
  }
  return block;
}

/** Argument équilibré de l'appel dont la parenthèse ouvrante est à `open`. */
function balancedArgument(source: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

/** `.returning()` sans argument dans l'instruction qui suit la position (jusqu'au prochain `;`). */
function returnsWholeRow(source: string, position: number): boolean {
  const end = source.indexOf(";", position);
  const statement = source.slice(position, end < 0 ? source.length : end);
  const at = statement.indexOf(".returning(");
  if (at < 0) return false;
  return balancedArgument(statement, at + ".returning".length)?.trim() === "";
}

/** Lectures entières (`select` vide ou ligne `missions`) et écritures `insert` / `update` qui renvoient la ligne entière. */
function findWholeMissionRows(source: string, key: string): string[] {
  const blocks: string[] = [];
  const reads = /\.(?:from|leftJoin|innerJoin|rightJoin)\(\s*missions\b/g;
  for (let match = reads.exec(source); match; match = reads.exec(source)) {
    const argument = selectArgument(source, match.index);
    if (argument !== null && isWholeRow(argument)) blocks.push(`${enclosingBlock(source, match.index)} (lecture)`);
  }
  const writes = /\.(insert|update)\(\s*missions\s*\)/g;
  for (let match = writes.exec(source); match; match = writes.exec(source)) {
    if (returnsWholeRow(source, match.index)) blocks.push(`${enclosingBlock(source, match.index)} (${match[1]} returning)`);
  }
  // Deux occurrences dans le même bloc : rang à l'intérieur du bloc seulement.
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const n = (seen.get(block) ?? 0) + 1;
    seen.set(block, n);
    return `${key} › ${block}${n > 1 ? ` #${n}` : ""}`;
  });
}

const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

describe("lectures entières de la table missions (montants du budget, Q19)", () => {
  const found = serverSources(serverDir).flatMap((path) => {
    const key = relative(root, path).replace(/\\/g, "/");
    return findWholeMissionRows(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), key);
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

  it("justifications vérifiables : écritures de /api/missions servies aux lecteurs du budget ou masquées", () => {
    for (const role of MISSION_MANAGER_ROLES) expect(MISSION_BUDGET_READ_ROLES as readonly string[], role).toContain(role);
    const src = read("server/api/missions.routes.ts");
    expect(src).toContain('router.post("/", authorize([...MISSION_MANAGER_ROLES]),');
    expect(src).toContain('router.patch("/:id", authorize([...MISSION_MANAGER_ROLES]),');
    const status = src.slice(src.indexOf('router.put("/:id/status"'), src.indexOf("\n});", src.indexOf('router.put("/:id/status"')));
    expect(status).toMatch(/res\.json\(redactMissionBudget\(req\.user, /);
    const broadcast = src.slice(src.indexOf("export async function broadcastMissionUpdate("), src.indexOf("\n}", src.indexOf("export async function broadcastMissionUpdate(")));
    expect(broadcast).toContain("mission: omitMissionBudget(");
  });

  it("le détecteur repère lectures et écritures entières, ignore les projections, nomme le bloc englobant", () => {
    expect(findWholeMissionRows("const r = await db.select().from(missions).where(x);", "f")).toEqual(["f › r (lecture)"]);
    expect(findWholeMissionRows("db.select({ mission: missions, id: a.id }).from(a).leftJoin(missions, eq(1, 1));", "f")).toEqual(["f › (module) (lecture)"]);
    expect(findWholeMissionRows("db.select(getTableColumns(missions)).from(missions);", "f")).toEqual(["f › (module) (lecture)"]);
    expect(findWholeMissionRows("db.select({ id: missions.id, status: missions.status }).from(missions);", "f")).toEqual([]);
    expect(findWholeMissionRows("await db.insert(missions).values(v).returning();", "f")).toEqual(["f › (module) (insert returning)"]);
    expect(findWholeMissionRows("await tx\n  .update(missions)\n  .set(v)\n  .returning( );", "f")).toEqual(["f › (module) (update returning)"]);
    expect(findWholeMissionRows("await db.update(missions).set(v).returning({ id: missions.id });", "f")).toEqual([]);
    expect(findWholeMissionRows("await db.update(missions).set(v).where(w);\nconst x = other.returning();", "f")).toEqual([]);
    const two = 'router.get("/a", h);\nfunction f() {\n  if (x) {\n    db.select().from(missions);\n  }\n}\nexport class S {\n  async g() {\n    db.select().from(missions);\n    db.select().from(missions);\n  }\n}';
    expect(findWholeMissionRows(two, "f")).toEqual(["f › f (lecture)", "f › g (lecture)", "f › g (lecture) #2"]);
    // Échanger deux lectures de blocs différents change les clés.
    const swapped = two.replace("    db.select().from(missions);\n  }\n}\nexport", "    db.select({ id: missions.id }).from(missions);\n  }\n}\nexport").replace("    db.select().from(missions);\n  }\n}\n", "    db.select().from(missions);\n    db.select().from(missions);\n  }\n}\n");
    expect(findWholeMissionRows(swapped, "f")).not.toEqual(findWholeMissionRows(two, "f"));
    expect(findWholeMissionRows('router.patch("/:id", async (req) => {\n  await db.select().from(missions);\n});', "f")).toEqual(["f › PATCH /:id (lecture)"]);
  });
});
