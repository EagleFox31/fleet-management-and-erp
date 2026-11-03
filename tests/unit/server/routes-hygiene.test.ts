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
 * 3. Lectures d'OT sans cloison (3 novembre 2026) : `GET /api/work-orders/:id/tire-rotations`
 *    n'exigeait qu'une session, un client lisait les rotations de tout OT. Toute lecture
 *    déclarée sur `/work-orders/:...` ou `:workOrderId` appelle `assertWorkOrderReadable`
 *    ou porte une garde de rôle (AGENTS.md §11).
 */
const WORK_ORDER_READ_EXCEPTIONS: Record<string, string> = {
  "server/routes.ts GET /api/work-orders/:id":
    "cloison client et technicien faite en ligne dans le handler (propriétaire du véhicule, technicien affecté)",
};
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

  it("toute lecture d'OT appelle assertWorkOrderReadable ou porte une garde de rôle", () => {
    const roleGuard = /\b(is(?!AnyUser\b)[A-Z]\w*|authorize\(|guardBy\w+)/;
    const declaration = /\b(?:app|router|\w+Routes)\.get\(\s*["'`]([^"'`]*(?:work-orders\/:|:workOrderId)[^"'`]*)["'`]/g;
    const nextDeclaration = /\n\s*(?:app|router|\w+Routes)\.(?:get|post|patch|put|delete|use)\(/;
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const path of serverSources(serverDir)) {
      const source = readFileSync(path, "utf8");
      const file = `server/${path.slice(serverDir.length + 1).replace(/\\/g, "/")}`;
      for (const match of source.matchAll(declaration)) {
        const rest = source.slice(match.index! + match[0].length);
        const end = rest.search(nextDeclaration);
        const body = end === -1 ? rest : rest.slice(0, end);
        const arrow = body.indexOf("=>");
        const header = arrow === -1 ? body : body.slice(0, arrow);
        const key = `${file} GET ${match[1]}`;
        seen.add(key);
        if (body.includes("assertWorkOrderReadable") || roleGuard.test(header)) continue;
        if (key in WORK_ORDER_READ_EXCEPTIONS) continue;
        offenders.push(key);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
    // une exception gelée qui n'existe plus doit sortir de la liste
    expect(Object.keys(WORK_ORDER_READ_EXCEPTIONS).filter((key) => !seen.has(key))).toEqual([]);
  });
});
