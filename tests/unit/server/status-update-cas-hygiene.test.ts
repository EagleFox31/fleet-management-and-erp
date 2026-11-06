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
 * Limite connue : `.set(variable)` n'est pas inspecté (le contenu n'est pas lisible
 * statiquement).
 */
const FROZEN: Record<string, number> = {
  "server/api/missions.routes.ts": 2,
  "server/api/quality-check.routes.ts": 1,
  // Journal d'exécution de la sauvegarde : ligne créée par le même job, pas de transition concurrente.
  "server/jobs/backup-production.ts": 1,
  "server/services/client-billing-service.ts": 1,
  "server/services/three-way-matching-service.ts": 1,
  "server/services/vehicle-status-service.ts": 3,
  "server/services/work-order-part-request.ts": 1,
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

/** Lignes des UPDATE qui écrivent `status` sous un WHERE réduit à `eq(<table>.id, …)`. */
function unguardedStatusUpdates(src: string): number[] {
  const lines: number[] = [];
  for (const m of src.matchAll(/\.update\(\s*\w+\s*\)\s*\.set\(/g)) {
    const setOpen = m.index! + m[0].length - 1;
    const setArg = enclosed(src, setOpen).trim();
    if (!SETS_STATUS.test(setArg.startsWith("{") ? setArg.slice(1) : setArg)) continue;
    const rest = src.slice(setOpen + setArg.length + 2);
    const where = rest.match(/^\s*\)?\s*\.where\(/);
    if (!where) continue;
    if (!ID_ONLY_WHERE.test(enclosed(rest, where[0].length - 1).trim())) continue;
    lines.push(src.slice(0, m.index).split("\n").length);
  }
  return lines;
}

describe("transitions de statut sans compare-and-set", () => {
  it("liste gelée à cliquet stricte, par fichier", () => {
    const found: Record<string, number> = {};
    for (const path of serverSources(join(repoDir, "server"))) {
      const count = unguardedStatusUpdates(readFileSync(path, "utf8")).length;
      if (count > 0) found[relative(repoDir, path).replace(/\\/g, "/")] = count;
    }
    expect(found).toEqual(FROZEN);
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
});
