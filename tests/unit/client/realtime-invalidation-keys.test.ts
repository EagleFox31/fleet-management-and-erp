import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KPI_QUERY_KEYS,
  REALTIME_EVENTS,
  WAREHOUSE_QUERY_KEYS,
  type RealtimeEventName,
} from "@shared/contracts/realtime-events";
import { MISSION_ADVISORY_ROLES, STAFF_ROLES } from "@shared/constants/roles";

/**
 * Une invalidation TanStack compare la clé élément par élément : `["/api/kpi"]` n'atteint pas
 * `["/api/kpi/failures"]`. Une clé de `invalidates` qui n'est le premier élément d'aucune
 * `queryKey` posée par un écran est donc un no-op silencieux (revue de la PR #59).
 */

const CLIENT_SRC = resolve(__dirname, "../../../client/src");
const CONTRACTS = resolve(__dirname, "../../../shared/contracts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * Premiers éléments des `queryKey` posées par le client : littéraux `queryKey: ["/api/..."]` et
 * constantes de chemin des contrats (`export const X_PATH = "/api/..."`), que `useContractQuery`
 * prend pour clé (`client/src/lib/contract-query.ts`).
 */
function declaredQueryKeys(): Set<string> {
  const keys = new Set<string>();
  const literal = /queryKey:\s*\[\s*["'`]([^"'`$]+)["'`]/g;
  for (const file of sourceFiles(CLIENT_SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(literal)) keys.add(match[1]);
  }
  const contractPath = /export const \w+_PATH\s*=\s*["'`](\/api\/[^"'`$]+)["'`]/g;
  for (const file of sourceFiles(CONTRACTS)) {
    for (const match of readFileSync(file, "utf8").matchAll(contractPath)) keys.add(match[1]);
  }
  return keys;
}

const declared = declaredQueryKeys();

/**
 * Clés dont l'écran n'existe pas encore sur cette base : les pages CDC-4 (ventes) et CDC-6 (carte)
 * sont encore vides. Les clés KPI en sont sorties avec #58 (`KPI_FAILURES_PATH`,
 * `KPI_MAINTENANCE_COSTS_PATH` dans shared/contracts/kpi.ts). Liste figée : retirer l'entrée quand la clé existe côté client.
 */
const AWAITING_SCREEN: Record<string, string> = {
  "/api/part-sales": "CDC-4 : écran des ventes de pièces",
  "/api/vehicle-positions": "CDC-6 : carte de la flotte",
};

describe("événements temps réel : clés d'invalidation", () => {
  const cases = (Object.keys(REALTIME_EVENTS) as RealtimeEventName[]).flatMap((event) =>
    REALTIME_EVENTS[event].invalidates.map((key) => [event, key] as const),
  );

  it("le client déclare des clés (le balayage fonctionne)", () => {
    expect(declared.size).toBeGreaterThan(50);
  });

  it.each(cases)("%s invalide %s : un écran pose cette clé", (_event, key) => {
    expect(declared.has(key) || key in AWAITING_SCREEN).toBe(true);
  });

  it("aucune clé d'invalidation n'est un simple préfixe de chemin sans clé propre", () => {
    const bare = cases.filter(([, key]) => !declared.has(key) && !(key in AWAITING_SCREEN));
    expect(bare).toEqual([]);
  });

  it("les listes partagées (KPI, magasin) ne contiennent que des clés posées par un écran ou attendues", () => {
    for (const key of [...KPI_QUERY_KEYS, ...WAREHOUSE_QUERY_KEYS]) expect(declared.has(key) || key in AWAITING_SCREEN).toBe(true);
  });

  it("la liste des clés en attente d'écran est figée", () => {
    expect(Object.keys(AWAITING_SCREEN).sort()).toEqual([
      "/api/part-sales",
      "/api/vehicle-positions",
    ]);
  });

  it("une clé en attente n'est plus tolérée dès que le client la pose", () => {
    for (const key of Object.keys(AWAITING_SCREEN)) expect(declared.has(key)).toBe(false);
  });
});

describe("événements temps réel : portées élargies", () => {
  const rolesOf = (event: RealtimeEventName) => {
    const scope = REALTIME_EVENTS[event].scope;
    return typeof scope === "object" && scope.type === "roles" ? scope.roles : [];
  };

  it("incident_reported couvre les lecteurs des avis de mission, logistique comprise", () => {
    for (const role of MISSION_ADVISORY_ROLES) expect(rolesOf("incident_reported")).toContain(role);
    expect(rolesOf("incident_reported")).toContain("logistics");
  });

  it("import_batch_applied couvre le personnel qui lit véhicules et ordres de travail, pas le client", () => {
    for (const role of STAFF_ROLES) expect(rolesOf("import_batch_applied")).toContain(role);
    expect(rolesOf("import_batch_applied")).not.toContain("client");
  });
});
