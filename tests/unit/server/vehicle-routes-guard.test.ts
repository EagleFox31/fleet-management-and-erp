import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de la cloison client (AGENTS.md section 11), issu d'une récidive : GET /api/vehicles,
 * puis les documents, puis le kilométrage, l'historique de statut, les pneus et les pleins
 * d'un véhicule ont chacun été livrés avec `authenticate` seul, donc lisibles par n'importe
 * quel client pour n'importe quel véhicule.
 *
 * `authenticate` ne charge pas le rôle. Toute route `/api/vehicles/...` ou `.../vehicle/:id`
 * doit déclarer `isAnyUser` (puis `canAccessOwned` / `ownerScopeOf`), `isStaff` ou un garde de
 * rôle (`isAdmin`, `isWorkshopManager`...).
 *
 * Liste gelée : routes dont le contrôle d'accès est fait dans le corps du handler, ou en dette
 * connue. Elle ne peut que diminuer.
 */
const KNOWN_AUTHENTICATE_ONLY = [
  // Contrôle de rôle et de propriétaire fait dans le handler (tests : vehicles-lists-client-scope).
  "get /api/vehicles",
  "get /api/vehicles/all",
  "get /api/vehicles/:id",
  // Contrôle de rôle fait dans le handler (lecture de l'utilisateur).
  "get /api/maintenance-schedules/vehicle/:vehicleId",
  // Routeur monté sous `isStaff` (server/api/index.ts) : le garde est au montage.
  "get /vehicle/:vehicleId/stats",
  "get /vehicle/:vehicleId/anomalies",
  // Export tabulaire et pneus montés : écrans du personnel, cloison à poser.
  "get /api/exports/vehicles",
  "get /api/vehicle-tires",
  "get /api/vehicle-tires/:vehicleTireId/last-inspection",
  // Sessions d'acquisition : cloison par propriétaire de la session (workflow-vehicle-acquisition).
  "post /api/workflows/vehicle-acquisition",
  "get /api/workflows/vehicle-acquisition/:sessionId",
  "patch /api/workflows/vehicle-acquisition/:sessionId",
  "patch /api/workflows/vehicle-acquisition/:sessionId/complete",
  "patch /api/workflows/vehicle-acquisition/:sessionId/abandon",
  "post /workflows/vehicle-acquisition",
  "patch /workflows/vehicle-acquisition/:sessionId",
];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const SOURCES = ["routes.ts", ...readdirSync(join(serverDir, "api")).filter((f) => f.endsWith(".ts")).map((f) => `api/${f}`)];

const DECLARATION =
  /\b(?:app|router|apiRouter)\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*([^()]*?)\s*(?:async\b|\(\s*req|\()/g;

/** Vrai si la route lit ou écrit un véhicule (chemin `/vehicles...` ou `.../vehicle/...`). */
export function touchesVehicle(path: string): boolean {
  return /\/vehicles?(\/|$)|\/vehicle-|\/vehicle\//.test(path);
}

/** Routes d'un source dont les middlewares ne contiennent que `authenticate` (ou rien). */
export function authenticateOnlyRoutes(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(DECLARATION)) {
    const [, method, path, middlewares] = m;
    if (!touchesVehicle(path)) continue;
    const names = middlewares.split(",").map((n) => n.trim()).filter(Boolean);
    const guarded = names.some((n) => n !== "authenticate");
    if (!guarded) found.push(`${method} ${path}`);
  }
  return found;
}

describe("garde de rôle sur les routes qui lisent un véhicule", () => {
  it("la détection repère un authenticate seul et ignore une route gardée", () => {
    const bad = `app.get("/api/vehicles/:id/foo", authenticate, async (req, res) => {});`;
    const good = `app.get("/api/vehicles/:id/foo", isAnyUser, async (req, res) => {});`;
    const staff = `router.put("/:id/mileage", isStaff, async (req, res, next) => {});`;
    const other = `app.get("/api/parts/:id", authenticate, async (req, res) => {});`;
    expect(authenticateOnlyRoutes(bad)).toEqual(["get /api/vehicles/:id/foo"]);
    expect(authenticateOnlyRoutes(good)).toEqual([]);
    expect(authenticateOnlyRoutes(staff)).toEqual([]);
    expect(authenticateOnlyRoutes(other)).toEqual([]);
  });

  it("la détection voit bien les déclarations des sources", () => {
    const all = SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8")));
    expect(all.length).toBeGreaterThan(5);
  });

  it("aucune nouvelle route véhicule n'est gardée par authenticate seul", () => {
    const all = [...new Set(SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8"))))];
    const fresh = all.filter((r) => !KNOWN_AUTHENTICATE_ONLY.includes(r));
    expect(
      fresh,
      "Route véhicule gardée par `authenticate` seul : `authenticate` ne connaît pas le rôle, un client lirait " +
        "n'importe quel véhicule. Utiliser `isAnyUser` + `canAccessOwned(req.user, ...)` (server/lib/client-scope.ts), " +
        "ou `isStaff` pour une saisie d'exploitation. Ne pas ajouter à KNOWN_AUTHENTICATE_ONLY.",
    ).toEqual([]);
  });

  it("la liste gelée ne contient que des routes qui existent encore", () => {
    const all = new Set(SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8"))));
    const stale = KNOWN_AUTHENTICATE_ONLY.filter((r) => !all.has(r));
    expect(
      stale,
      "Entrée gelée sans route correspondante (route gardée ou supprimée) : la retirer de KNOWN_AUTHENTICATE_ONLY.",
    ).toEqual([]);
  });
});
