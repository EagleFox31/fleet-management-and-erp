import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DestinationsChart } from "../../../client/src/components/operations/destinations-chart";
import { ApiError } from "../../../client/src/lib/api-error";

// Les composants utilisent le runtime JSX classique (React global) : absent en environnement node.
(globalThis as { React?: typeof React }).React = React;

/**
 * Onglet Destinations des opérations. L'ancien composant attendait un objet indexé et un `totalCost` jamais
 * servi. Avec la liste réellement servie (rouge sur 253c9a3a) : cartes titrées « 0 », « 1 » au lieu des
 * destinations, « Coût » N/A, « Revenu » = carburant estimé, et « Marge » = NaN, affichée « N/A » en rouge
 * par `formatPrice`.
 */
const SERVED = [
  { destination: "NDJAMENA", count: 2, totalFuel: 900, totalFuelCost: 450000, totalRevenue: 500000, estimatedFuelCost: 500000 },
  { destination: "TOUBORO", count: 2, totalFuel: 300, totalFuelCost: 150000, totalRevenue: 0, estimatedFuelCost: 0 },
];
const REDACTED = SERVED.map((row) => ({ ...row, totalRevenue: null, estimatedFuelCost: null }));

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(DestinationsChart, props as any));

describe("onglet Destinations", () => {
  it("réponse réellement servie : vraies destinations, ni marge, ni revenu, ni NaN", () => {
    const html = render({ data: SERVED });
    expect(html).toContain(">NDJAMENA</h3>");
    expect(html).toContain(">TOUBORO</h3>");
    expect(html).not.toMatch(/>\d+<\/h3>/);
    expect(html).not.toMatch(/NaN|N\/A/);
    expect(html).not.toMatch(/Marge|Revenu|Chiffre d'affaires/i);
    expect(html).toContain("Carburant réel");
    expect(html).toContain("Carburant estimé");
    expect(html).toContain("50.0%");
  });

  it("lecteur hors budget (Q19) : la ligne du carburant estimé disparaît, rien n'est inventé", () => {
    const html = render({ data: REDACTED });
    expect(html).not.toContain("Carburant estimé");
    expect(html).toContain("Carburant réel");
    expect(html).not.toMatch(/NaN/);
  });

  it("erreur : encart lisible, jamais « aucune donnée »", () => {
    const html = render({ error: new ApiError(500, "Erreur serveur. Référence : r-1", {}) });
    expect(html).toContain('data-testid="destinations-error"');
    expect(html).not.toContain("destinations-empty");
  });

  it("réponse qui n'est pas une liste (ancien objet indexé) : erreur, pas une liste vide", () => {
    const html = render({ data: { NDJAMENA: SERVED[0] } });
    expect(html).toContain('data-testid="destinations-error"');
  });

  it("liste vide : état vide explicite", () => {
    expect(render({ data: [] })).toContain('data-testid="destinations-empty"');
  });

  it("compteur illisible : part non calculée, valeur Indisponible", () => {
    const html = render({ data: [{ ...SERVED[0], count: "abc" }, SERVED[1]] });
    expect(html).not.toMatch(/NaN|%<\/span>/);
    expect(html).toContain("Indisponible");
  });
});
