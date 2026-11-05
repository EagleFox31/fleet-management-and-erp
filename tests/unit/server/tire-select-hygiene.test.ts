import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Prix d'achat des pneus (`tires.purchasePrice`) : lu par le personnel hors chauffeur
 * (`server/lib/tire-price-scope.ts`).
 *
 * Toute requête qui lit la table `tires` sans projection explicite (`select()` vide, `{ tires: tires }`,
 * `getTableColumns(tires)`), en `from` ou en jointure, ramène la colonne du prix. Si le résultat
 * atteint une réponse HTTP ou une trame temps réel, le prix fuit (c'est arrivé par la jointure des
 * pneus montés). Les occurrences existantes sont gelées avec leur justification (masquées en aval par
 * `redactTirePrice`, ou jamais servies). La liste doit rester strictement égale : une occurrence
 * nouvelle ou supprimée fait échouer le test.
 */
const FROZEN: Record<string, string> = {
  "server/services/tires-service-simplified.ts#1": "getTire : GET /api/tires/:id masque par redactTirePrice",
  "server/services/tires-service-simplified.ts#2": "getTires : GET /api/tires masque par redactTirePrice",
  "server/services/tires-service-simplified.ts#3": "deleteTire : lecture interne avant suppression logique, rien n'est renvoyé",
  "server/services/tires-service-simplified.ts#4": "getVehicleTires : GET /api/vehicles/:id/tires masque la fiche pneu par redactTirePrice",
  "server/services/tires-service-simplified.ts#5": "getVehicleTire : aucun appelant, à projeter avant tout usage",
  "server/services/tires-service-simplified.ts#6": "calculateRequiredActions : réservé à statistics-advanced, route refusée au chauffeur (isTireValuationReader)",
  "server/services/tires-service-simplified.ts#7": "getLowStockTires : GET /api/tires/low-stock masque par redactTirePrice",
};

const root = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Argument équilibré de l'appel `.select(` commençant à `start`. */
function selectArgument(source: string, start: number): string | null {
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

export function isWholeTireRow(argument: string): boolean {
  const compact = argument.split(/\s+/).join("");
  return compact === "" || /:tires[,}]/.test(compact + "}") || compact.includes("getTableColumns(tires)");
}

/** Une requête (jusqu'au `;`) qui lit `tires` sans projection explicite. */
export function wholeTireReads(source: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const start = source.indexOf(".select(", from);
    if (start < 0) break;
    from = start + 1;
    const argument = selectArgument(source, start);
    if (argument === null) continue;
    const end = source.indexOf(";", start);
    const statement = source.slice(start, end < 0 ? undefined : end);
    const readsTires = statement.includes("from(tires)") || statement.includes("Join(tires,");
    if (readsTires && isWholeTireRow(argument)) count++;
  }
  if (/row_to_json\(\s*t(ires)?\.\*/.test(source)) count++;
  return count;
}

function current(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const path of serverSources(join(root, "server"))) {
    const n = wholeTireReads(readFileSync(path, "utf8"));
    const rel = relative(root, path).split(sep).join("/");
    for (let i = 1; i <= n; i++) found[`${rel}#${i}`] = "";
  }
  return found;
}

describe("lectures entières de la table tires", () => {
  it("détecte select() vide, table entière et getTableColumns, pas une projection explicite", () => {
    expect(wholeTireReads("db.select().from(tires).where(x);")).toBe(1);
    expect(wholeTireReads("db.select().from(vt).leftJoin(tires, eq(a, b));")).toBe(1);
    expect(wholeTireReads("db.select({ t: tires }).from(vt).leftJoin(tires, eq(a, b));")).toBe(1);
    expect(wholeTireReads("db.select(getTableColumns(tires)).from(tires);")).toBe(1);
    expect(wholeTireReads("db.select({ id: tires.id, brand: tires.brand }).from(tires);")).toBe(0);
    expect(wholeTireReads("db.select().from(vehicles);")).toBe(0);
  });

  it("les lectures entières existantes sont gelées avec leur justification (la liste ne bouge que sciemment)", () => {
    const found = Object.keys(current()).sort();
    expect(found, "Lecture entière de tires ajoutée ou retirée : projeter explicitement, ou masquer par redactTirePrice et déclarer ici").toEqual(Object.keys(FROZEN).sort());
  });

  it("chaque entrée gelée porte une justification", () => {
    for (const [key, why] of Object.entries(FROZEN)) expect(why.trim().length, key).toBeGreaterThan(10);
  });
});
