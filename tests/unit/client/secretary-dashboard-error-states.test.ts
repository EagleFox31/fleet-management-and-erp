import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * /secretary/dashboard : chaque lecture en échec affichait 0 comme une vraie valeur (chiffre
 * d'affaires, coûts, factures, solde, documents à renouveler, chauffeurs CPC, véhicules), et la
 * tuile « Coûts totaux » lisait `totalCost`, champ que `GET /api/operations/stats/by-client` ne
 * sert pas : elle valait toujours 0 F.
 * Garde de source : un retour du repli à zéro ou d'une requête déstructurée échoue ici.
 */
const PAGE = "client/src/pages/secretary/dashboard.tsx";
const src = readFileSync(new URL(`../../../${PAGE}`, import.meta.url), "utf8");

const KEYS = [
  "/api/vehicles/all",
  "/api/vehicles/document-stats",
  "/api/drivers/cpc-statistics",
  "/api/drivers/cpc-status",
  "/api/operations/stats/by-client",
  "/api/billing/invoices/summary",
];

/** Déclaration `const … = useQuery(…)` qui porte la clé. */
function declarationOf(key: string): string {
  const keyAt = src.indexOf(`queryKey: ["${key}"]`);
  expect(keyAt, `clé ${key} introuvable`).toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf("const ", keyAt), keyAt);
}

describe("tableau de bord secrétaire : une lecture en échec n'est pas un zéro", () => {
  it.each(KEYS)("%s : requête gardée entière (état d'erreur conservé)", (key) => {
    expect(declarationOf(key)).not.toMatch(/const\s*\{/);
  });

  it("aucun repli à zéro", () => {
    // Seule exception : le plus grand des trois relevés kilométriques d'un véhicule (hors lot).
    const outsideMileage = src.replace(/const getEffectiveMileage[^;]+;/, "");
    expect(src.match(/\|\|\s*0\b/g) ?? []).toEqual([]);
    expect(outsideMileage.match(/\?\?\s*0\b/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/Array\.isArray\(\w+\)\s*\?\s*[\w.]+\s*:\s*(0|\[\])/);
  });

  it("chiffres lus par les helpers partagés, pas par le module pneus", () => {
    expect(src).toMatch(/from "@\/lib\/secretary-dashboard-stats"/);
    expect(src).not.toMatch(/tire-statistics-view/);
  });

  it("coûts lus dans totalFuelCost, le champ servi ; plus jamais totalCost", () => {
    expect(src).not.toMatch(/\btotalCost\b/);
    expect(src).toMatch(/totalFuelCost/);
  });

  it("chaque tuile chiffrée passe par statDisplay (« Indisponible » si inconnu)", () => {
    const tiles = [
      "secretary-kpi-vehicles", "secretary-kpi-documents", "secretary-kpi-missions",
      "secretary-kpi-fuel-estimated", "secretary-kpi-costs", "secretary-kpi-invoices",
      "secretary-kpi-pending", "secretary-kpi-paid", "secretary-kpi-cpc-formed",
      "secretary-kpi-cpc-to-form", "secretary-kpi-cpc-not-formed",
    ];
    for (const id of tiles) {
      const at = src.indexOf(`data-testid="${id}"`);
      expect(at, `${id} introuvable`).toBeGreaterThan(-1);
      const tile = src.slice(at, src.indexOf("/>", at));
      expect(tile, id).toMatch(/value=\{statDisplay\(/);
    }
  });

  it("carburant estimé jamais présenté comme chiffre d'affaires, ni marge qui en découle", () => {
    // Décision 0a du 2026-11-09 : `totalRevenue` de stats/by-client somme des carburants estimés.
    const tile = src.slice(src.indexOf('data-testid="secretary-kpi-fuel-estimated"'));
    expect(tile.slice(0, tile.indexOf("/>"))).toMatch(/label="Coût carburant estimé \(missions\)"/);
    expect(src).not.toMatch(/Chiffre d'affaires|Facturé clients|>CA<|Marge|Bénéfice/i);
    expect(src).not.toMatch(/marginPercentage|profit/i);
  });

  it("listes en échec : un encart, pas un vide", () => {
    for (const id of ["secretary-clients-error", "secretary-vehicles-error", "secretary-drivers-error"]) {
      expect(src).toMatch(new RegExp(`data-testid="${id}"`));
    }
  });
});
