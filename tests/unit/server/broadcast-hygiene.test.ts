import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Portée temps réel fermée par défaut (LESSONS_LEARNED, « Portée temps réel fermée par
 * défaut »). Une portée absente ou invalide n'envoie plus rien (`server/lib/realtime-scope.ts`) ;
 * un événement n'atteint tout le monde, clients compris, que par `scope: { type: "broadcast" }`.
 * Trois fuites vers des clients sont passées par là (#53, #127, #151).
 *
 * Ce test gèle les `type: "broadcast"` explicites de `server/` : fichier et nombre, sans numéro de
 * ligne. La liste ne peut que rétrécir : restreindre un événement à une portée rôle/user fait
 * baisser le compte, il faut alors diminuer la valeur ci-dessous. Toute hausse échoue.
 *
 * `server/lib/realtime-scope.ts` (qui interprète la portée) et `server/_archive/` sont exclus.
 *
 * Chaque entrée porte sa justification. Les événements d’ordre de travail ne sont plus ici : ils partent
 * au personnel (`server/lib/work-order-realtime-scope.ts`), jamais à un client.
 */
const KNOWN_BROADCASTS: Record<string, { count: number; why: string }> = {
  "shared/contracts/realtime-events.ts": {
    count: 3,
    why: "type RealtimeScope (1) + portées par défaut de fuel_price_changed et vehicle_document_type_changed (2), prix et types de papier lus par tous les profils",
  },
  "server/api/billing.routes.ts": { count: 1, why: "événements de facturation suivis par plusieurs profils" },
  "server/api/clients.routes.ts": { count: 1, why: "événements client suivis par plusieurs profils" },
  "server/api/drivers-management.routes.ts": { count: 1, why: "événements chauffeur suivis par plusieurs profils" },
  "server/api/drivers.routes.ts": { count: 1, why: "événements chauffeur suivis par plusieurs profils" },
  "server/api/fuel-card.routes.ts": { count: 1, why: "événements carte carburant suivis par plusieurs profils" },
  "server/api/operations.routes.ts": { count: 1, why: "opérations suivies par plusieurs profils" },
  "server/api/purchase-orders.routes.ts": { count: 1, why: "commandes fournisseur suivies par plusieurs profils" },
  "server/api/supplier-invoices.routes.ts": { count: 1, why: "factures fournisseur suivies par plusieurs profils" },
  "server/api/suppliers.routes.ts": { count: 1, why: "fournisseurs suivis par plusieurs profils" },
  "server/api/vehicles.routes.ts": { count: 1, why: "véhicules suivis par plusieurs profils" },
  "server/routes.ts": { count: 1, why: "recharge carte carburant (fichier gelé, ne pas en ajouter)" },
  "server/scheduler.ts": { count: 1, why: "factures client en retard, tâche de fond sans acteur" },
  "server/services/tires-service-simplified.ts": { count: 1, why: "pneus suivis par plusieurs profils" },
};

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const repoDir = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function currentBroadcasts(): Record<string, number> {
  const counts: Record<string, number> = {};
  // Les portées par défaut des événements vivent aussi dans le contrat partagé.
  const sources = [...serverSources(serverDir), join(repoDir, "shared/contracts/realtime-events.ts")];
  for (const path of sources) {
    const rel = relative(repoDir, path).split(sep).join("/");
    if (rel === "server/lib/realtime-scope.ts") continue;
    const n = (readFileSync(path, "utf8").match(/type:\s*["']broadcast["']/g) ?? []).length;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

const ADVICE =
  "utiliser une portée rôle/user ; un broadcast doit être ajouté à la liste avec justification " +
  "(KNOWN_BROADCASTS dans tests/unit/server/broadcast-hygiene.test.ts)";

describe("hygiène des broadcasts temps réel", () => {
  it("aucun nouveau type: \"broadcast\" dans server/", () => {
    const now = currentBroadcasts();
    const added = Object.entries(now)
      .filter(([file, n]) => n > (KNOWN_BROADCASTS[file]?.count ?? 0))
      .map(([file, n]) => `${file} : ${n} au lieu de ${KNOWN_BROADCASTS[file]?.count ?? 0}`);
    expect(added, `Broadcast ajouté sans justification : ${ADVICE}`).toEqual([]);
  });

  it("la liste gelée ne garde que des broadcasts qui existent encore (elle ne peut que rétrécir)", () => {
    const now = currentBroadcasts();
    const stale = Object.entries(KNOWN_BROADCASTS)
      .filter(([file, { count }]) => (now[file] ?? 0) < count)
      .map(([file, { count }]) => `${file} : ${now[file] ?? 0} au lieu de ${count}`);
    expect(stale, "Broadcast supprimé ou restreint : diminuer ou retirer l'entrée de KNOWN_BROADCASTS").toEqual([]);
  });

  it("chaque appel de broadcastUpdate (et alias) porte une portée explicite", () => {
    // Sans portée l'événement est désormais muet (realtime-scope.ts) : il faut le voir à la revue.
    const callStart = /(?:^|[^\w$])(?:[\w$]+\.)?(broadcastUpdate|broadcast|fn)\(/g;
    const missing: string[] = [];
    for (const path of serverSources(serverDir)) {
      const rel = relative(repoDir, path).split(sep).join("/");
      if (rel === "server/lib/realtime-scope.ts") continue;
      const source = readFileSync(path, "utf8");
      if (!/broadcastUpdate/.test(source)) continue;
      for (const match of source.matchAll(callStart)) {
        const open = match.index! + match[0].length - 1;
        let depth = 0;
        let end = open;
        for (; end < source.length; end++) {
          if (source[end] === "(") depth++;
          else if (source[end] === ")" && --depth === 0) break;
        }
        const args = source.slice(open + 1, end);
        const line = source.slice(0, open).split("\n").length;
        const secondArg = args.slice(args.indexOf(",") + 1);
        const forwarder = /^\s*event\s*,\s*data\s*$/.test(args); // enveloppe qui relaie tel quel
        const explicit = /\bscope\b/.test(secondArg);
        const spreadOfScoped = /\.\.\.base\b/.test(secondArg) && /\bscope:\s*\w+/.test(source); // vehicle-documents
        if (args.includes(",") && (explicit || spreadOfScoped)) continue;
        if (forwarder) continue;
        missing.push(`${rel}:${line} ${match[1]}(…)`);
      }
    }
    expect(missing, `Appel sans portée explicite (il ne partirait à personne) : ajouter scope: { type: "roles" | "user" | "broadcast", … }`).toEqual([]);
  });

  it("chaque entrée a une justification", () => {
    for (const [file, { why }] of Object.entries(KNOWN_BROADCASTS)) {
      expect(why.trim().length, file).toBeGreaterThan(10);
    }
  });
});
