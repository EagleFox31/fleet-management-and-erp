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
  "get /api/vehicles/:id",
  // Contrôle de rôle fait dans le handler (lecture de l'utilisateur).
  "get /api/maintenance-schedules/vehicle/:vehicleId",
  // Export tabulaire : écran du personnel, couvert au montage (exportsGuard) ; pneus montés retirés (lot A4).
  "get /api/exports/vehicles",
  // Lecture de la session d'acquisition : cloison par propriétaire de la session (workflow-vehicle-acquisition). Les écritures portent isWorkflowDocumentWriter (R2).
  "get /api/workflows/vehicle-acquisition/:sessionId",
];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const SOURCES = ["routes.ts", ...readdirSync(join(serverDir, "api")).filter((f) => f.endsWith(".ts") && f !== "index.ts").map((f) => `api/${f}`)];

/**
 * Préfixe de montage de chaque routeur de `server/api` (`apiRouter.use("/vehicles", vehiclesRoutes)`
 * sous `/api`) : un chemin déclaré `/:id/x` dans `vehicles.routes.ts` est `/api/vehicles/:id/x`.
 * Sans lui, une route déclarée relativement échappait à `touchesVehicle`.
 */
export function mountPrefixes(indexSource: string): Map<string, { prefix: string; guarded: boolean }> {
  const fileOf = new Map<string, string>();
  for (const m of indexSource.matchAll(/import\s+(\w+)\s+from\s+"\.\/([\w.-]+)"/g)) fileOf.set(m[1], `api/${m[2]}.ts`);
  const prefixes = new Map<string, { prefix: string; guarded: boolean }>();
  for (const m of indexSource.matchAll(/apiRouter\.use\(([^;]*?)\);/gs)) {
    const args = m[1];
    const prefix = args.match(/^\s*"([^"]*)"/)?.[1] ?? "";
    for (const name of args.match(/\b\w+Routes\b/g) ?? []) {
      const file = fileOf.get(name);
      if (!file) continue;
      // Un garde de rôle au montage (`apiRouter.use("/x", isStaff, xRoutes)`) couvre tout le routeur.
      const before = args.slice(0, args.indexOf(name)).split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith('"'));
      prefixes.set(file, { prefix: `/api${prefix}`, guarded: before.some((n) => n !== "authenticate") });
    }
  }
  return prefixes;
}
const PREFIXES = mountPrefixes(readFileSync(join(serverDir, "api", "index.ts"), "utf8"));

const DECLARATION =
  /\b\w*(?:app|[rR]outer|Routes)\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*([^()]*?)\s*(?:async\b|\(\s*req|\()/g;

/** Vrai si la route lit ou écrit un véhicule (chemin `/vehicles...` ou `.../vehicle/...`). */
export function touchesVehicle(path: string): boolean {
  return /\/vehicles?(\/|$)|\/vehicle-|\/vehicle\//.test(path);
}

/** Routes d'un source dont les middlewares ne contiennent que `authenticate` (ou rien). */
export function authenticateOnlyRoutes(source: string, prefix = "", mountGuarded = false): string[] {
  if (mountGuarded) return [];
  const found: string[] = [];
  for (const m of source.matchAll(DECLARATION)) {
    const [, method, declared, middlewares] = m;
    const path = declared.startsWith("/api/") ? declared : `${prefix}${declared}`;
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

  it("un chemin relatif d'un routeur monté sous /vehicles est résolu avec son préfixe", () => {
    const index = `import vehiclesRoutes from "./vehicles.routes";\nimport fuelCardRoutes from "./fuel-card.routes";\n` +
      `apiRouter.use("/vehicles", vehiclesRoutes);\napiRouter.use("/fuel-card", isStaff, fuelCardRoutes);`;
    const prefixes = mountPrefixes(index);
    expect(prefixes.get("api/vehicles.routes.ts")).toEqual({ prefix: "/api/vehicles", guarded: false });
    expect(prefixes.get("api/fuel-card.routes.ts")).toEqual({ prefix: "/api/fuel-card", guarded: true });
    const leak = `router.get("/:id/leak", authenticate, async (req, res) => {});`;
    expect(authenticateOnlyRoutes(leak)).toEqual([]);
    expect(authenticateOnlyRoutes(leak, "/api/vehicles")).toEqual(["get /api/vehicles/:id/leak"]);
  });

  it("la détection voit bien les déclarations des sources", () => {
    const all = SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8"), PREFIXES.get(f)?.prefix ?? "", PREFIXES.get(f)?.guarded ?? false));
    expect(all.length).toBeGreaterThan(3);
  });

  it("aucune nouvelle route véhicule n'est gardée par authenticate seul", () => {
    const all = [...new Set(SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8"), PREFIXES.get(f)?.prefix ?? "", PREFIXES.get(f)?.guarded ?? false)))];
    const fresh = all.filter((r) => !KNOWN_AUTHENTICATE_ONLY.includes(r));
    expect(
      fresh,
      "Route véhicule gardée par `authenticate` seul : `authenticate` ne connaît pas le rôle, un client lirait " +
        "n'importe quel véhicule. Utiliser `isAnyUser` + `canAccessOwned(req.user, ...)` (server/lib/client-scope.ts), " +
        "ou `isStaff` pour une saisie d'exploitation. Ne pas ajouter à KNOWN_AUTHENTICATE_ONLY.",
    ).toEqual([]);
  });

  it("la liste gelée ne contient que des routes qui existent encore", () => {
    const all = new Set(SOURCES.flatMap((f) => authenticateOnlyRoutes(readFileSync(join(serverDir, f), "utf8"), PREFIXES.get(f)?.prefix ?? "", PREFIXES.get(f)?.guarded ?? false)));
    const stale = KNOWN_AUTHENTICATE_ONLY.filter((r) => !all.has(r));
    expect(
      stale,
      "Entrée gelée sans route correspondante (route gardée ou supprimée) : la retirer de KNOWN_AUTHENTICATE_ONLY.",
    ).toEqual([]);
  });
});
