import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Transition de statut écrite sans condition sur l'état de départ :
 * `db.update(t).set({ status: … }).where(eq(t.id, id))`.
 *
 * Un tel UPDATE écrase n'importe quel statut. Une facture payée pouvait être réapprouvée,
 * et deux approbations simultanées écrivaient deux fois (#533). La forme attendue est un
 * compare-and-set : le statut de départ est dans le WHERE, et l'absence de ligne écrite
 * (`.returning()`) est traitée.
 *
 * Les occurrences existantes sont gelées par fichier, dans une liste à cliquet stricte :
 * - un nombre en hausse fait échouer le test (nouvelle transition sans garde) ;
 * - un nombre en baisse aussi : il faut alors abaisser la liste.
 * Une écriture de statut légitimement inconditionnelle (création, journal de tâche) se
 * déclare ici avec sa raison, jamais en contournant le motif.
 *
 * `.set(variable)` et `.set({ ...variable })` sont résolus vers la déclaration locale
 * `const|let|var variable = { … }` la plus proche, plus ses affectations `variable.status = …`.
 * Ce qui ne se résout pas en littéral local (paramètre, corps de requête, appel de fonction)
 * est illisible statiquement : compté à part dans `FROZEN_OPAQUE`, avec le même cliquet. Une
 * telle écriture peut porter un statut venu de l'appelant ; la rendre lisible ou la passer en
 * compare-and-set fait baisser la liste.
 */
const FROZEN: Record<string, number> = {
  // Dont une via `.set(missionUpdates)`, visible depuis la résolution des variables.
  "server/api/missions.routes.ts": 3,
  "server/api/quality-check.routes.ts": 1,
  // Journal d'exécution de la sauvegarde : ligne créée par le même job, pas de transition concurrente.
  "server/jobs/backup-production.ts": 1,
  "server/services/client-billing-service.ts": 1,
  "server/services/vehicle-status-service.ts": 3,
  "server/services/work-order-part-request.ts": 1,
};

/** Contenu écrit illisible statiquement sous `eq(<table>.id, …)` seul (voir l'en-tête). */
const FROZEN_OPAQUE: Record<string, number> = {
  "server/api/clients.routes.ts": 1,
  "server/api/document-renewal-centers.routes.ts": 1,
  "server/api/fault-catalog.routes.ts": 1,
  "server/services/documentStorage.ts": 1,
  "server/services/parts-service.ts": 1,
  "server/services/qhse-inspection-service.ts": 1,
  "server/services/supplier-management-service.ts": 1,
  "server/services/tariff-grid-service.ts": 1,
  "server/services/tires-service-simplified.ts": 1,
  // Méthodes génériques `update<Entité>(id, data)`.
  "server/storage.ts": 6,
};

const repoDir = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Contenu entre la parenthèse (ou accolade) ouvrante à `open` et sa fermante. */
function enclosed(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

const SETS_STATUS = /(^|[{,\s])status\s*[:,}]/;
const ID_ONLY_WHERE = /^eq\(\s*[\w.]+\.id\s*,[^()]*(\([^()]*\))?[^()]*\)$/;

/**
 * Littéral de la déclaration locale `const|let|var <name> … = { … }` la plus proche avant `at`,
 * complété d'un ` status,` si `<name>.status = …` est affecté ensuite. `null` si le nom ne se
 * résout pas en littéral (paramètre, appel, expression).
 */
function localObject(src: string, at: number, name: string): string | null {
  const before = src.slice(0, at);
  const decl = [...before.matchAll(new RegExp(`(?:const|let|var)\\s+${name}\\b[^=;]*=\\s*`, "g"))].at(-1);
  if (!decl) return null;
  const tail = before.slice(decl.index! + decl[0].length);
  if (!tail.startsWith("{")) return null;
  const assigned = new RegExp(`\\b${name}\\.status\\s*=(?!=)`).test(tail);
  return enclosed(tail, 0) + (assigned ? " status," : "");
}

/** Ce que le `.set(…)` écrit : un statut, rien de tel, ou un contenu illisible statiquement. */
function setContent(src: string, at: number, setArg: string): "status" | "other" | "opaque" {
  let body: string | null;
  if (/^\w+$/.test(setArg)) body = localObject(src, at, setArg);
  else if (setArg.startsWith("{")) body = setArg.slice(1);
  else body = null;
  if (body === null) return "opaque";
  if (SETS_STATUS.test(body)) return "status";
  for (const spread of body.matchAll(/\.\.\.\s*([\w.]+)(\s*\()?/g)) {
    const inner = spread[2] || spread[1].includes(".") ? null : localObject(src, at, spread[1]);
    if (inner === null) return "opaque";
    if (SETS_STATUS.test(inner)) return "status";
  }
  return "other";
}

/**
 * Lignes des UPDATE sous un WHERE réduit à `eq(<table>.id, …)` : celles qui écrivent `status`,
 * et celles dont le contenu écrit n'est pas lisible.
 */
function idOnlyUpdates(src: string): { status: number[]; opaque: number[] } {
  const found = { status: [] as number[], opaque: [] as number[] };
  for (const m of src.matchAll(/\.update\(\s*\w+\s*\)\s*\.set\(/g)) {
    const setOpen = m.index! + m[0].length - 1;
    const setArg = enclosed(src, setOpen).trim();
    const rest = src.slice(setOpen + setArg.length + 2);
    const where = rest.match(/^\s*\)?\s*\.where\(/);
    if (!where) continue;
    if (!ID_ONLY_WHERE.test(enclosed(rest, where[0].length - 1).trim())) continue;
    const content = setContent(src, m.index!, setArg);
    if (content !== "other") found[content].push(src.slice(0, m.index).split("\n").length);
  }
  return found;
}

const unguardedStatusUpdates = (src: string) => idOnlyUpdates(src).status;

describe("transitions de statut sans compare-and-set", () => {
  const scan = () => {
    const status: Record<string, number> = {};
    const opaque: Record<string, number> = {};
    for (const path of serverSources(join(repoDir, "server"))) {
      const found = idOnlyUpdates(readFileSync(path, "utf8"));
      const file = relative(repoDir, path).replace(/\\/g, "/");
      if (found.status.length > 0) status[file] = found.status.length;
      if (found.opaque.length > 0) opaque[file] = found.opaque.length;
    }
    return { status, opaque };
  };

  it("liste gelée à cliquet stricte, par fichier", () => {
    expect(scan().status).toEqual(FROZEN);
  });

  it("contenu illisible sous eq(id) seul : liste gelée à cliquet stricte, par fichier", () => {
    expect(scan().opaque).toEqual(FROZEN_OPAQUE);
  });
});

describe("le scan ne se laisse pas tromper", () => {
  const flagged = (src: string) => unguardedStatusUpdates(src).length;

  it("signale un statut écrit sous eq(id) seul, sur une ou plusieurs lignes", () => {
    expect(flagged(`await db.update(invoices).set({ status: "approved" }).where(eq(invoices.id, id));`)).toBe(1);
    expect(flagged(`await tx\n  .update(orders)\n  .set({\n    approvedAt: new Date(),\n    status,\n  })\n  .where(eq(orders.id, Number(req.params.id)))\n  .returning();`)).toBe(1);
  });

  it("ignore un compare-and-set, un autre champ, un WHERE sur une autre colonne", () => {
    expect(flagged(`db.update(t).set({ status: "x" }).where(and(eq(t.id, id), eq(t.status, "y")));`)).toBe(0);
    expect(flagged(`db.update(t).set({ status: "x" }).where(and(eq(t.id, id), inArray(t.status, ["a", "b"])));`)).toBe(0);
    expect(flagged(`db.update(t).set({ paymentStatus: "x", notes }).where(eq(t.id, id));`)).toBe(0);
    expect(flagged(`db.update(t).set({ status: "x" }).where(eq(t.vehicleId, id));`)).toBe(0);
  });

  it("résout une variable ou un spread vers son littéral local", () => {
    expect(flagged(`const data: any = { status, updatedAt: now };\nawait db.update(t).set(data).where(eq(t.id, id));`)).toBe(1);
    expect(flagged(`const data: any = { updatedAt: now };\nif (x) data.status = "y";\nawait db.update(t).set(data).where(eq(t.id, id));`)).toBe(1);
    expect(flagged(`const patch = { status: "x" };\nawait db.update(t).set({ ...patch, updatedAt: now }).where(eq(t.id, id));`)).toBe(1);
    expect(flagged(`const data = { notes };\nawait db.update(t).set(data).where(eq(t.id, id));`)).toBe(0);
    expect(flagged(`const data = { status };\nawait db.update(t).set(data).where(and(eq(t.id, id), eq(t.status, "a")));`)).toBe(0);
  });

  it("compte à part un contenu illisible : paramètre, corps, appel", () => {
    const opaque = (src: string) => idOnlyUpdates(src).opaque.length;
    expect(opaque(`async function u(id: number, data: Partial<T>) { await db.update(t).set(data).where(eq(t.id, id)); }`)).toBe(1);
    expect(opaque(`await db.update(t).set({ ...req.body, updatedAt: now }).where(eq(t.id, id));`)).toBe(1);
    expect(opaque(`await db.update(t).set({ ...valuesOf(body) }).where(eq(t.id, id));`)).toBe(1);
    expect(opaque(`const data = { notes };\nawait db.update(t).set({ ...data }).where(eq(t.id, id));`)).toBe(0);
  });
});
