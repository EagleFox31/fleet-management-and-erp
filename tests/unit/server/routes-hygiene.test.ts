import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Deux garde-fous issus d'incidents réels (LESSONS_LEARNED, 29 octobre 2026).
 *
 * 1. Routes déclarées deux fois dans `server/routes.ts` : Express sert la
 *    première, la seconde est du code mort qui a l'air vivant. Le premier
 *    `PATCH /api/maintenance-schedules/:id` n'écrivait que `isActive` : toute
 *    modification du formulaire était perdue en silence. Liste gelée, elle ne
 *    peut que rétrécir : vidée le 3 novembre 2026 (les six doublons restants
 *    ont été supprimés, comportement servi figé par contrat :
 *    `fleet-history`, `part-usage-history`, `check-all-maintenance`,
 *    `maintenance-schedules`, et `warehouse.routes.ts` pour les deux routes
 *    magasin). Toute nouvelle entrée est une régression.
 * 2. `POST /api/users` journalisait `req.body` par `console.log`, donc le mot de
 *    passe en clair. Un corps de requête ne se journalise que par
 *    `moduleLogger`, dont la configuration masque `*.password`.
 */
const KNOWN_DUPLICATE_ROUTES: string[] = [];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("hygiène des routes serveur", () => {
  it("aucune nouvelle route déclarée deux fois dans server/routes.ts", () => {
    const source = readFileSync(join(serverDir, "routes.ts"), "utf8");
    const routes = [...source.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes.length).toBeGreaterThan(0);
    const duplicates = [...new Set(routes.filter((route, index) => routes.indexOf(route) !== index))];
    expect(duplicates.sort()).toEqual([...KNOWN_DUPLICATE_ROUTES].sort());
  });

  it("aucun corps de requête journalisé par console.*", () => {
    const offenders = serverSources(serverDir).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /console\.\w+\(.*req\.body/.test(line))
        .map(({ index }) => `${path.slice(serverDir.length + 1)}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});
