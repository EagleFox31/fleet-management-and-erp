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
 * Chaque entrée porte sa justification. « OT » = comportement historique des événements d'ordre
 * de travail, qui retombaient en broadcast faute de portée avant la règle fermée : rendu explicite
 * à l'identique, à restreindre (décision produit : un client reçoit-il l'OT d'un autre ?).
 */
const KNOWN_BROADCASTS: Record<string, { count: number; why: string }> = {
  "server/api/billing.routes.ts": { count: 1, why: "événements de facturation suivis par plusieurs profils" },
  "server/api/clients.routes.ts": { count: 1, why: "événements client suivis par plusieurs profils" },
  "server/api/document-renewals.routes.ts": { count: 2, why: "véhicule et alerte sans destinataire nominatif (PR #151 en cours)" },
  "server/api/drivers-management.routes.ts": { count: 1, why: "événements chauffeur suivis par plusieurs profils" },
  "server/api/drivers.routes.ts": { count: 1, why: "événements chauffeur suivis par plusieurs profils" },
  "server/api/fuel-card.routes.ts": { count: 1, why: "événements carte carburant suivis par plusieurs profils" },
  "server/api/missions.routes.ts": { count: 3, why: "missions suivies par plusieurs profils" },
  "server/api/operations.routes.ts": { count: 1, why: "opérations suivies par plusieurs profils" },
  "server/api/part-requirements.routes.ts": { count: 3, why: "OT : demandes de pièce créées, modifiées, supprimées" },
  "server/api/purchase-orders.routes.ts": { count: 1, why: "commandes fournisseur suivies par plusieurs profils" },
  "server/api/supplier-invoices.routes.ts": { count: 1, why: "factures fournisseur suivies par plusieurs profils" },
  "server/api/suppliers.routes.ts": { count: 1, why: "fournisseurs suivis par plusieurs profils" },
  "server/api/technician-work-orders.routes.ts": { count: 1, why: "OT : mise à jour par le technicien" },
  "server/api/vehicles.routes.ts": { count: 1, why: "véhicules suivis par plusieurs profils" },
  "server/api/warehouse.routes.ts": { count: 1, why: "magasin suivi par plusieurs profils" },
  "server/api/work-order-items.routes.ts": { count: 1, why: "OT : lignes de travail (point d'émission unique `diffuser`)" },
  "server/api/work-order-parts.routes.ts": { count: 6, why: "OT : pièces demandées, utilisées, OT en attente de pièces" },
  "server/index.ts": { count: 1, why: "pont LISTEN/NOTIFY des triggers Postgres : toujours broadcast" },
  "server/routes.ts": { count: 6, why: "OT créé/modifié/supprimé, pièce retirée, recharge carte (fichier gelé, ne pas en ajouter)" },
  "server/scheduler.ts": { count: 1, why: "factures client en retard, tâche de fond sans acteur" },
  "server/services/incident-service.ts": { count: 1, why: "OT créé depuis un incident" },
  "server/services/preventive-maintenance-service.ts": { count: 1, why: "OT : création préventive" },
  "server/services/procurement-service.ts": { count: 2, why: "OT : pièces livrées ou reçues" },
  "server/services/technician-work-orders-service.ts": { count: 1, why: "OT : changement de statut par le technicien" },
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
  for (const path of serverSources(serverDir)) {
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

  it("chaque entrée a une justification", () => {
    for (const [file, { why }] of Object.entries(KNOWN_BROADCASTS)) {
      expect(why.trim().length, file).toBeGreaterThan(10);
    }
  });
});
