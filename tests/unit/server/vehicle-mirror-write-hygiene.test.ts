import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * P3-2, garde-fou d'hygiène : écriture directe du miroir.
 *
 * `vehicle_documents` fait foi ; les colonnes `vehicles.insuranceExpiry`,
 * `licensePlateExpiry` et `technicalInspectionDate` en sont le miroir lu par
 * l'éligibilité mission et par les alertes. Une écriture hors du chemin prévu
 * (`server/lib/vehicle-document-mirror.ts`) peut le faire reculer ou diverger.
 *
 * Le test scanne `server/` (hors `_archive` et variantes mortes
 * `vehicle-activation-service-*` / `vehicle-deletion-service-*`) et compare les
 * `UPDATE` de `vehicles` qui touchent une colonne miroir à des listes GELÉES.
 * Tout nouvel emplacement fait échouer le test.
 *
 * Dette connue, listes à vider :
 *  - D3 fait : le PATCH /api/documents/:id vit dans server/api/vehicle-documents.routes.ts
 *    et passe par la lib du miroir ; `FROZEN_DIRECT_WRITES` est vide et le reste.
 *  - `storage.updateVehicle` fait `.set(vehicle)` sur un objet quelconque : la clé n'est
 *    pas lisible statiquement. C'est le chemin des fiches véhicule (PATCH /api/vehicles/:id).
 *    Gelé aussi : un nouvel appelant générique de ce type doit être décidé consciemment.
 */

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

/** Chemin prévu : la lib du miroir (dépôt = "later", correction = "set", recalcul après suppression). */
const SANCTIONED = ["server/lib/vehicle-document-mirror.ts"];

/** Écritures directes de colonnes miroir hors lib : fichier -> nombre d'`UPDATE`. */
const FROZEN_DIRECT_WRITES: Record<string, number> = {

};

/** `.set(<variable>)` sur `vehicles` : clés invisibles au scan. */
const FROZEN_GENERIC_WRITES: Record<string, number> = {
  "server/storage.ts": 1,
};

const MIRROR_KEYS = /\b(insuranceExpiry|licensePlateExpiry|technicalInspectionDate|insurance_expiry|license_plate_expiry|technical_inspection_date)\b/;
const COMPUTED_KEY = /\[\s*(key|column|field)\s*\]\s*:/;
const DEAD_CODE = /vehicle-(activation|deletion)-service-/;

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") && !DEAD_CODE.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(join(serverDir, ".."), path).split(sep).join("/");

type Hit = { file: string; kind: "mirror" | "generic" | "alias" };

/** `.set(variable)` ou `.set({ ...variable })` : les clés écrites sont invisibles au scan. */
const GENERIC_SET = /\.set\(\s*(?:[A-Za-z_$][\w$.]*\s*\)|\{[^}]*\.\.\.)/;

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const path of serverSources(serverDir)) {
    const source = readFileSync(path, "utf8");
    const file = rel(path);
    // `import { vehicles as v }` : un alias contourne les regex sur le nom, on le signale.
    const aliases = [...source.matchAll(/\bvehicles\s+as\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (let i = 0; i < aliases.length; i++) hits.push({ file, kind: "alias" });
    const table = [String.raw`[\w.]*vehicles`, ...aliases].join("|");
    // Drizzle : `.update(vehicles)` / `.update(schema.vehicles)` puis `.set(...)` ;
    // SQL brut : `UPDATE vehicles`, `UPDATE "vehicles"`, `UPDATE public.vehicles`.
    const updates = new RegExp(String.raw`\.update\(\s*(?:${table})\s*\)|UPDATE\s+"?(?:public"?\."?)?vehicles"?(?![\w])`, "gi");
    for (const start of source.matchAll(updates)) {
      const rest = source.slice(start.index ?? 0);
      const stop = rest.search(/\.where\(|WHERE\b|\.returning\(/i);
      const window = rest.slice(0, stop === -1 ? 600 : Math.min(stop, 800));
      if (MIRROR_KEYS.test(window) || COMPUTED_KEY.test(window)) hits.push({ file, kind: "mirror" });
      else if (GENERIC_SET.test(window)) hits.push({ file, kind: "generic" });
    }
    // Upsert : `insert(vehicles).values(...).onConflictDoUpdate({ set: { insuranceExpiry } })`.
    const inserts = new RegExp(String.raw`\.insert\(\s*(?:${table})\s*\)`, "g");
    for (const start of source.matchAll(inserts)) {
      const window = source.slice(start.index ?? 0, (start.index ?? 0) + 1500);
      const at = window.indexOf("onConflictDoUpdate");
      if (at === -1) continue;
      const set = window.slice(at, at + 600);
      if (MIRROR_KEYS.test(set) || COMPUTED_KEY.test(set)) hits.push({ file, kind: "mirror" });
      else if (/set:\s*(?:[A-Za-z_$][\w$.]*\s*[,}]|\{[^}]*\.\.\.)/.test(set)) hits.push({ file, kind: "generic" });
    }
  }
  return hits;
}

function countByFile(hits: Hit[], kind: Hit["kind"], skip: string[] = []): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const hit of hits) {
    if (hit.kind !== kind || skip.includes(hit.file)) continue;
    counts[hit.file] = (counts[hit.file] ?? 0) + 1;
  }
  return counts;
}

describe("écriture directe du miroir de documents véhicule (hygiène)", () => {
  const hits = scan();

  it("la détection voit le chemin prévu et les écritures gelées", () => {
    expect(hits.filter((h) => SANCTIONED.includes(h.file)).length).toBeGreaterThanOrEqual(2);
  });

  it("aucune écriture d'une colonne miroir hors de la lib, hors liste gelée", () => {
    expect(countByFile(hits, "mirror", SANCTIONED)).toEqual(FROZEN_DIRECT_WRITES);
  });

  it("aucun nouvel `UPDATE vehicles` générique (.set(variable), .set({ ...p })), hors liste gelée", () => {
    expect(countByFile(hits, "generic")).toEqual(FROZEN_GENERIC_WRITES);
  });

  it("aucun alias de la table (`vehicles as v`) : il masquerait les écritures au scan", () => {
    expect(countByFile(hits, "alias")).toEqual({});
  });
});
