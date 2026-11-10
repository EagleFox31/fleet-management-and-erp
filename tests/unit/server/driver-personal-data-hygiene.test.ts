import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou R-03 / R-13 : les données personnelles d'un chauffeur (CNI, permis, naissance,
 * embauche) ne sont lisibles que par `DRIVER_PERSONAL_DATA_READER_ROLES` et par le chauffeur
 * concerné. Une sélection `drivers.<champ>` ailleurs que dans les fichiers qui appliquent la
 * rédaction risque de les renvoyer à tout le personnel (cas de GET /api/missions/:id, #127).
 *
 * Liste gelée : elle ne peut que rétrécir. Un nouvel usage passe par `redactDriverPersonalData`
 * (server/lib/driver-scope.ts) ou ne sert qu'à un calcul interne, et s'ajoute ici avec son motif.
 */
const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

const PERSONAL_FIELD = /\bdrivers\.(cniNumber|licenseNumber|birthDate|hireDate|cniExpiry|licenseExpiry)\b/g;

/** Fichier -> nombre d'occurrences tolérées. */
const ALLOWED: Record<string, number | "any"> = {
  "lib/driver-scope.ts": "any",
  "services/cpc-training-service.ts": "any",
  "api/drivers-management.routes.ts": "any",
  // Contrôle de validité du permis au lancement d'une mission : la date n'est pas renvoyée,
  // seul un booléen ou un message en sort (préparation ~1368, PUT /:id/status ~2286).
  "api/missions.routes.ts": 2,
  // Raison : le palier se calcule sur les dates d'échéance ; le message ne reprend que le nom et la date d'échéance (ni numéro de pièce, ni naissance, ni adresse).
  "services/alert-service.ts": 4,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "_archive" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const usages = walk(serverDir)
  .map((full) => ({
    path: relative(serverDir, full).replace(/\\/g, "/"),
    hits: readFileSync(full, "utf8").match(PERSONAL_FIELD) ?? [],
  }))
  .filter((f) => f.hits.length > 0);

describe("données personnelles chauffeur côté serveur", () => {
  it("drivers.<champ personnel> uniquement dans les fichiers autorisés", () => {
    const offenders = usages
      .filter((f) => {
        const allowed = ALLOWED[f.path];
        if (allowed === "any") return false;
        return allowed === undefined || f.hits.length > allowed;
      })
      .map((f) => `${f.path} (${f.hits.join(", ")})`);
    expect(offenders).toEqual([]);
  });

  it("la liste gelée ne garde pas de place inutile", () => {
    const stale = Object.entries(ALLOWED)
      .filter(([, n]) => typeof n === "number")
      .filter(([path, n]) => (usages.find((f) => f.path === path)?.hits.length ?? 0) < (n as number))
      .map(([path]) => path);
    expect(stale).toEqual([]);
  });
});
