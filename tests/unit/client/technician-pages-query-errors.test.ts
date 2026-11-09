import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Pages technicien : une requête en échec n'est ni une liste vide ni un coût nul.
 *
 * Troisième occurrence du défaut « échec pris pour du vide » (#592, #593, #594) : le tableau de
 * bord, « Mes OT » (start_url de la PWA) et le profil ne lisaient que `isLoading` et faisaient
 * `workOrders || []`. Une panne affichait « aucun OT » et des 0. Voir
 * `docs/analysis/LESSONS_LEARNED.md`, entrée du 2026-11-07.
 *
 * 1. Les trois pages qui lisent `/api/technician/my-work-orders` passent par la vue partagée
 *    (`technicianWorkOrdersView` / `technicianProfileView`) et affichent `InlineQueryError`.
 * 2. Contrôle plus large : toute page de `client/src/pages/technician/` qui appelle `useQuery`
 *    doit traiter l'erreur (vue partagée, `queryView`, `isError` ou `InlineQueryError`). Les pages
 *    existantes qui ne le font pas encore sont gelées : la liste ne peut que rétrécir.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pagesDir = join(repoRoot, "client", "src", "pages", "technician");
const read = (name: string) => readFileSync(join(pagesDir, name), "utf8");

const ERROR_HANDLING = /technicianWorkOrdersView(<[^>]*>)?\(|technicianProfileView\(|queryView\(|isError|InlineQueryError/;

const KNOWN_LOADING_ONLY: string[] = [];

export function readsQueryWithoutError(text: string): boolean {
  return /\buseQuery\b/.test(text) && !ERROR_HANDLING.test(text);
}

describe("pages technicien : branchement de l'état d'erreur", () => {
  it.each(["dashboard.tsx", "my-work-orders.tsx", "profile.tsx"])(
    "%s passe par la vue partagée et affiche InlineQueryError",
    (name) => {
      const text = read(name);
      expect(text).toMatch(/technicianWorkOrdersView(<[^>]*>)?\(|technicianProfileView\(/);
      expect(text).toMatch(/<InlineQueryError\b/);
      expect(text).not.toMatch(/workOrders\s*\|\|\s*\[\]/);
      expect(text).not.toMatch(/isLoading/);
    },
  );

  it("« Mes OT » n'affiche jamais un coût inconnu comme 0", () => {
    const text = read("my-work-orders.tsx");
    expect(text).not.toMatch(/formatPrice\([^)]*cost\s*\|\|\s*0\)/);
    expect(text).toMatch(/workOrderCostLabel\(/);
  });

  it("le profil affiche les totaux par formatKnownCost", () => {
    const text = read("profile.tsx");
    expect(text).toMatch(/formatKnownCost\(/);
    expect(text).not.toMatch(/formatPrice\((totalCost|averageCost|partsCost|tiresCost|maintenanceCost)\)/);
  });

  const pages = readdirSync(pagesDir).filter((name) => name.endsWith(".tsx")).sort();
  const detected = pages.filter((name) => readsQueryWithoutError(read(name)));

  it("aucune nouvelle page technicien ne lit une requête sans traiter son erreur", () => {
    expect(detected.filter((name) => !KNOWN_LOADING_ONLY.includes(name))).toEqual([]);
  });

  it("cliquet : une page gelée qui traite désormais l'erreur sort de la liste", () => {
    expect(KNOWN_LOADING_ONLY.filter((name) => !detected.includes(name))).toEqual([]);
  });

  it("le détecteur repère isLoading seul et accepte une erreur traitée", () => {
    expect(readsQueryWithoutError("const { data, isLoading } = useQuery({});")).toBe(true);
    expect(readsQueryWithoutError("const q = useQuery({}); const v = queryView(q);")).toBe(false);
    expect(readsQueryWithoutError("const { isError } = useQuery({});")).toBe(false);
    expect(readsQueryWithoutError("const x = 1;")).toBe(false);
  });
});
