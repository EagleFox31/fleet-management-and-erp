import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde d'hygiène : lecture d'affectations dans une route `/:id/*` de missions.routes.ts.
 *
 * `router.param("id")` cloisonne la mission (un chauffeur non affecté reçoit 403), pas
 * l'affectation que le handler lit ensuite. Sans filtre, `.limit(1)` ou la première ligne lue peut être
 * une affectation annulée/refusée, ou la fiche d'un autre chauffeur de la mission. Tout handler
 * `/:id/*` ouvert aux chauffeurs (donc sans `authorize([...MISSION_MANAGER_ROLES])`) qui lit
 * `assignments` doit passer par `driverLiveAssignmentFilter` ou `driverScopeOf`.
 *
 * Même modèle que assignment-write-hygiene.test.ts : liste gelée qui ne peut que rétrécir.
 */

const routesFile = fileURLToPath(new URL("../../../server/api/missions.routes.ts", import.meta.url));

/** Handlers lisant `assignments` sans filtre de portée, gelés : liste à vider, jamais à remplir. */
const FROZEN_UNSCOPED: string[] = [
  "GET /:id/document-renewal-requests",
  "POST /:id/document-renewal-requests",
];

const ROUTE = /^router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/gm;
const READS_ASSIGNMENTS = /\.from\(\s*assignments\s*\)|\.(left|inner)Join\(\s*assignments\b/;
const SCOPED = /driverLiveAssignmentFilter|driverScopeOf/;
const STAFF_ONLY = /authorize\(\s*\[\s*\.\.\.MISSION_MANAGER_ROLES\s*\]\s*\)/;

/** Handlers `/:id/*` (ou `/:id`) ouverts aux chauffeurs qui lisent `assignments` sans portée. */
export function unscopedAssignmentReads(source: string): string[] {
  const routes = [...source.matchAll(ROUTE)];
  const faulty: string[] = [];
  routes.forEach((match, i) => {
    const path = match[2];
    if (!path.startsWith("/:id")) return;
    const body = source.slice(match.index!, routes[i + 1]?.index ?? source.length);
    const head = body.slice(0, body.indexOf("=>"));
    if (STAFF_ONLY.test(head)) return;
    if (READS_ASSIGNMENTS.test(body) && !SCOPED.test(body)) faulty.push(`${match[1].toUpperCase()} ${path}`);
  });
  return faulty;
}

describe("missions.routes.ts : lecture d'affectations cloisonnée", () => {
  const source = readFileSync(routesFile, "utf8");

  it("aucun nouveau handler /:id/* ouvert aux chauffeurs ne lit assignments sans portée", () => {
    const fresh = unscopedAssignmentReads(source).filter((h) => !FROZEN_UNSCOPED.includes(h));
    expect(fresh, "ajouter driverLiveAssignmentFilter ou driverScopeOf, pas la liste gelée").toEqual([]);
  });

  it("la liste gelée ne garde que des fautifs", () => {
    const faulty = unscopedAssignmentReads(source);
    const cured = FROZEN_UNSCOPED.filter((h) => !faulty.includes(h));
    expect(cured, "retirer ces handlers corrigés de FROZEN_UNSCOPED").toEqual([]);
  });

  it("le garde attrape une violation simulée", () => {
    const bad = `router.get("/:id/foo", async (req, res) => {\n  await db.select().from(assignments).where(eq(assignments.missionId, 1)).limit(1);\n});\n`;
    expect(unscopedAssignmentReads(bad)).toEqual(["GET /:id/foo"]);
    const joined = `router.post("/:id/bar", async (req, res) => {\n  db.select().from(missions).leftJoin(assignments, eq(assignments.missionId, missions.id));\n});\n`;
    expect(unscopedAssignmentReads(joined)).toEqual(["POST /:id/bar"]);
  });

  it("accepte portée, staff seul et route hors /:id", () => {
    const scoped = `router.get("/:id/a", async () => {\n  db.select().from(assignments).where(driverLiveAssignmentFilter(s));\n});\n`;
    const viaScope = `router.get("/:id/b", async () => {\n  const s = await driverScopeOf(u);\n  db.select().from(assignments);\n});\n`;
    const staff = `router.post("/:id/c", authorize([...MISSION_MANAGER_ROLES]), async () => {\n  db.select().from(assignments);\n});\n`;
    const list = `router.get("/", async () => {\n  db.select().from(assignments);\n});\n`;
    for (const ok of [scoped, viaScope, staff, list]) expect(unscopedAssignmentReads(ok)).toEqual([]);
  });

  it("le fichier réel : les handlers cloisonnés sont reconnus", () => {
    const faulty = unscopedAssignmentReads(source);
    for (const h of ["GET /:id", "GET /:id/launch-readiness", "PUT /:id/status"]) expect(faulty).not.toContain(h);
  });
});
