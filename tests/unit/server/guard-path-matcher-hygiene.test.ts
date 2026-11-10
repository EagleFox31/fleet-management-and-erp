import { describe, expect, it } from "vitest";
import { readRepoFiles, REPO_SCAN_TIMEOUT_MS, repoFiles } from "../../support/repo-files";

/**
 * Garde-fou issu de LESSONS_LEARNED (10 novembre 2026, garde de double affectation contournée par
 * `PATCH /api/work-orders/%36%32`) : une garde qui reconnaît sa route en lisant elle-même le chemin
 * (regex, comparaison, préfixe) ne lit pas la cible comme Express. Casse, `%xx` et barre finale
 * passent la route servie mais pas la garde. Une garde de `server/middleware/` reconnaît sa route par
 * un matcher Express (`Router().patch("/:id", ...)`, voir `booking-guard.ts`, `retired-vehicle-write-guard.ts`).
 *
 * Restent permis : lire `req.path` pour un refus par défaut (liste d'autorisation, segment absent de la
 * matrice), où une lecture divergente ne peut que refuser davantage. Liste tolérée qui ne peut que rétrécir.
 */

const PATH_SOURCE = String.raw`req\.(?:path|originalUrl|url)\b`;
const FORBIDDEN: Array<[string, RegExp]> = [
  ["regex appliquée au chemin", new RegExp(String.raw`\.(?:test|exec)\(\s*${PATH_SOURCE}`)],
  ["méthode de chaîne sur le chemin", new RegExp(String.raw`${PATH_SOURCE}\s*\.\s*(?:match|matchAll|replace|search|startsWith|endsWith|includes)\(`)],
  ["comparaison du chemin", new RegExp(String.raw`${PATH_SOURCE}\s*[!=]==?|[!=]==?\s*${PATH_SOURCE}`)],
  ["cible brute", /\breq\.(?:originalUrl|url)\b/],
];

/** Fichier → motifs tolérés (constat du 10 novembre 2026). Vide : aucune garde ne lit son chemin ainsi. */
const TOLERATED = new Map<string, string[]>();

function violations(source: string): string[] {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\*|\/\/)/.test(line))
    .flatMap((line) => FORBIDDEN.filter(([, re]) => re.test(line)).map(([label]) => label));
}

/**
 * Lectures du chemin déclarées (cliquet) : toute garde qui lit `req.path`, `req.url`, `req.originalUrl`
 * ou `routedPath(` figure ici avec son motif. Chaque lecture ne peut que refuser davantage ou porter sur
 * un segment fail-closed ; une nouvelle lecture exige d'ajouter la ligne et son motif, une lecture retirée
 * exige de la retirer (la liste ne peut que rétrécir).
 */
const DECLARED_PATH_READS = new Map<string, string>([
  ["server/middleware/exports-guard.ts", "premier segment comparé à une liste d'exports : un segment illisible n'est pas un export, la route répond"],
  ["server/middleware/idempotency-guard.ts", "chemin normalisé par routedPath pour la clé d'idempotence, pas pour reconnaître une route protégée"],
  ["server/middleware/route-id-range-guard.ts", "refus par défaut d'un identifiant hors plage : une lecture divergente ne peut que refuser davantage"],
  ["server/middleware/viewer-read-only-guard.ts", "liste d'autorisation des écritures du lecteur : un chemin non reconnu est refusé"],
]);
const PATH_READ = /\breq\.(?:path|originalUrl|url)\b|\broutedPath\(/;

function readsPath(source: string): boolean {
  return source.split(/\r?\n/).filter((line) => !/^\s*(?:\*|\/\/)/.test(line)).some((line) => PATH_READ.test(line));
}

describe("gardes de server/middleware : matcher Express, jamais lecture du chemin", { timeout: REPO_SCAN_TIMEOUT_MS }, () => {
  it("détecte l'ancienne garde de double affectation (regex sur req.path)", () => {
    expect(violations('const patchId = req.method === "PATCH" ? /^\\/(\\d+)\\/?$/.exec(req.path)?.[1] : undefined;')).toContain("regex appliquée au chemin");
    expect(violations('const isCreate = req.method === "POST" && (req.path === "/" || req.path === "");')).toContain("comparaison du chemin");
    expect(violations('if (req.path.startsWith("/api")) {')).toContain("méthode de chaîne sur le chemin");
    expect(violations("const raw = req.originalUrl;")).toContain("cible brute");
  });

  it("laisse passer un matcher Express et une lecture fail-closed", () => {
    expect(violations('matcher.patch("/:id", guardWrite(false));')).toEqual([]);
    expect(violations('const segment = req.path.split("/").filter(Boolean)[0] ?? "";')).toEqual([]);
    expect(violations(" * `req.path` : casse et barre finale (commentaire)")).toEqual([]);
  });

  it("aucune garde ne reconnaît sa route en lisant le chemin (liste tolérée qui ne peut que rétrécir)", async () => {
    const files = await readRepoFiles(repoFiles({ under: ["server/middleware"], match: /guard[^/]*\.ts$/i }));
    expect(files.length).toBeGreaterThan(0);
    const found = new Map(files.map(([file, source]) => [file, [...new Set(violations(source))]]).filter(([, v]) => v.length > 0) as Array<[string, string[]]>);
    expect(Object.fromEntries([...found].filter(([file]) => !TOLERATED.has(file)))).toEqual({});
    expect([...TOLERATED.keys()].filter((f) => !found.has(f)), "tolérance devenue inutile").toEqual([]);
  });
  it("détecte une lecture du chemin, hors commentaire", () => {
    expect(readsPath("const segment = req.path.split('/')[0];")).toBe(true);
    expect(readsPath("const p = routedPath(req);")).toBe(true);
    expect(readsPath(" * `req.path` : casse (commentaire)")).toBe(false);
    expect(readsPath("matcher.patch('/:id', guardWrite(false));")).toBe(false);
  });

  it("toute lecture du chemin dans une garde est déclarée avec son motif (liste qui ne peut que rétrécir)", async () => {
    const files = await readRepoFiles(repoFiles({ under: ["server/middleware"], match: /guard[^/]*\.ts$/i }));
    const reading = files.filter(([, source]) => readsPath(source)).map(([file]) => file.replaceAll("\\", "/"));
    const declared = [...DECLARED_PATH_READS.keys()];
    expect(reading.filter((f) => !declared.some((d) => f.endsWith(d))), "lecture non déclarée").toEqual([]);
    expect(declared.filter((d) => !reading.some((f) => f.endsWith(d))), "déclaration devenue inutile").toEqual([]);
  });
});
