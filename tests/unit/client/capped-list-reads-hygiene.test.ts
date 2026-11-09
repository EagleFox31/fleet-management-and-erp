import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : aucune lecture de liste plafonnée par un `limit` en dur dans `client/src`.
 *
 * Récidive côté client (LESSONS_LEARNED, 2026-11-09) : `fetch('/api/vehicles?limit=1000')`
 * dans les rapports PDF, après les 50 premiers OT d'un appel sans `limit` (#599). Un plafond
 * en dur rend une liste tronquée sans aucun signal dès que le volume le dépasse. Lire page par
 * page (`fetchAllPages`, `client/src/lib/fetch-all-pages.ts`) ou paginer l'écran.
 *
 * Repère : `?limit=` ou `&limit=` suivi d'un nombre d'au moins trois chiffres, ou `limit: <nombre>`
 * d'au moins trois chiffres (paramètres d'une `queryKey`). Un « top N » (`limit=8`) n'est pas visé.
 *
 * Cliquet : les cas existants sont gelés par fichier ; le compte ne peut que baisser, et une
 * entrée devenue fausse doit être retirée de la liste.
 */
const FROZEN: Record<string, number> = {
  // Export PDF de l'inventaire des pièces : 1000 premières pièces seulement.
  "client/src/pages/inventory/index.tsx": 1,
  // Liste des interventions : 1000 premiers OT.
  "client/src/pages/maintenance/interventions.tsx": 1,
  // Alertes par date et liste des OT de maintenance : 300 premiers OT.
  "client/src/pages/maintenance/date-based-alerts.tsx": 1,
  "client/src/pages/maintenance/work-orders.tsx": 1,
  // Sélecteur de pièces de l'OT : 1000 premières pièces.
  "client/src/pages/maintenance/work-orders/[id].tsx": 1,
  // Dialogue de montage : 500 premiers véhicules et 500 premiers pneus.
  "client/src/components/vehicles/vehicle-tire-mount-dialog.tsx": 2,
};

const ROOT = join(__dirname, "..", "..", "..");
const CAPPED = [/[?&]limit=\d{3,}\b/g, /\blimit\s*:\s*\d{3,}\b/g];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function cappedReads(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(join(ROOT, "client", "src"))) {
    const src = readFileSync(file, "utf8");
    const count = CAPPED.reduce((n, re) => n + (src.match(re)?.length ?? 0), 0);
    if (count > 0) found[relative(ROOT, file).split(sep).join("/")] = count;
  }
  return found;
}

describe("lectures de liste plafonnées par un limit en dur (client/src)", () => {
  const found = cappedReads();

  it("aucun nouveau plafond en dur, aucun compte gelé qui augmente", () => {
    const excess = Object.entries(found)
      .filter(([file, count]) => count > (FROZEN[file] ?? 0))
      .map(([file, count]) => `${file} : ${count} (gelé : ${FROZEN[file] ?? 0})`);
    expect(excess).toEqual([]);
  });

  it("cliquet : une entrée gelée corrigée sort de la liste", () => {
    const stale = Object.entries(FROZEN)
      .filter(([file, count]) => (found[file] ?? 0) < count)
      .map(([file, count]) => `${file} : ${found[file] ?? 0} (gelé : ${count})`);
    expect(stale).toEqual([]);
  });

  it("le repère voit bien les deux formes", () => {
    const sample = "fetch('/api/vehicles?limit=1000'); queryKey: ['/api/parts', { limit: 1000 }]; fetch('/api/top?limit=8')";
    expect(CAPPED.reduce((n, re) => n + (sample.match(re)?.length ?? 0), 0)).toBe(2);
  });
});
