import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * /inventory/tires lit `GET /api/tires/statistics-advanced` par `toTireStatisticsView` : une
 * statistique illisible ou absente s'affiche « Indisponible », jamais 0. Avant ce branchement,
 * la page retombait sur `|| 0` et montrait un stock vide ou zéro alerte comme de vraies valeurs.
 * Garde de source : un retour du repli à zéro ou d'une conversion locale échoue ici.
 */
const PAGE = "client/src/pages/inventory/tires/index.tsx";
const src = readFileSync(new URL(`../../../${PAGE}`, import.meta.url), "utf8");

/** Déclaration `const … = useQuery(…)` qui porte la clé des statistiques. */
function statsQueryDeclaration(): string {
  const keyAt = src.indexOf('queryKey: ["/api/tires/statistics-advanced"]');
  expect(keyAt, "clé statistics-advanced introuvable").toBeGreaterThan(-1);
  const end = src.indexOf("});", keyAt);
  return src.slice(src.lastIndexOf("const ", keyAt), end);
}

describe("page pneus : statistiques lues par le contrat", () => {
  it("la requête convertit la réponse une seule fois par toTireStatisticsView", () => {
    const declaration = statsQueryDeclaration();
    expect(declaration).toMatch(/useQuery<TireStatisticsAdvancedJson, Error, TireStatisticsView>/);
    expect(declaration).toMatch(/select: toTireStatisticsView/);
  });

  it("aucun repli à zéro ni conversion locale sur les statistiques", () => {
    const zeroFallback = /\b(statistics|statsActions)\b[\w?.[\]]*\s*(\|\||\?\?)\s*0\b/g;
    expect(src.match(zeroFallback) ?? []).toEqual([]);
    expect(src).not.toMatch(/(parseInt|parseFloat|Number)\(\s*statistics/);
    expect(src).not.toMatch(/interface TireStatistics\b/);
  });

  it("les tuiles chiffrées passent par statText (« Indisponible » si inconnu)", () => {
    for (const field of ["totalTires", "totalValue", "averageWear", "rotationsThisMonth"]) {
      expect(src, field).toMatch(new RegExp(`statText\\(statistics\\?\\.${field}\\b`));
    }
  });

  it("sans inspection active : « Aucune inspection », pas 0 mm", () => {
    expect(src).toMatch(/statistics\?\.noInspection \? "Aucune inspection"/);
  });

  it("statistiques en échec : une seule erreur à l'écran (l'encart en tête de page)", () => {
    expect(src.match(/error=\{pageState\.statsError\.error\}/g) ?? []).toHaveLength(1);
  });
});
