import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * `GET /api/alerts` en échec : les trois écrans qui le lisent sans `isError` affichaient
 * « 0 alerte », « Aucune alerte récente » ou « Tout est à jour » comme de vraies valeurs.
 * Chacun passe désormais par `listQueryView` et montre l'erreur, jamais un 0.
 * Garde de source : un retour à `{ data: alerts }` sans état d'erreur échoue ici.
 */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Déclaration `const … = useQuery(…)` qui porte la clé `/api/alerts`. */
function alertsQueryDeclaration(src: string): string {
  const keyAt = src.indexOf('queryKey: ["/api/alerts"]');
  expect(keyAt, "clé /api/alerts introuvable").toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf("const ", keyAt), keyAt);
}

const SCREENS: Array<{ path: string; shows: RegExp[] }> = [
  {
    path: "client/src/pages/secretary/dashboard.tsx",
    shows: [/alertsFailed \? UNAVAILABLE/, /data-testid="secretary-alerts-unavailable"/],
  },
  {
    path: "client/src/components/alerts/alerts-panel.tsx",
    shows: [/data-testid="alerts-db-error"/, /UNAVAILABLE/],
  },
  {
    path: "client/src/components/dashboard/dashboard-alerts-summary.tsx",
    shows: [/data-testid="dashboard-alerts-error"/],
  },
];

describe.each(SCREENS)("$path : /api/alerts en échec n'est pas un vide", ({ path, shows }) => {
  const src = read(path);

  it("la requête est gardée entière et lue par listQueryView", () => {
    const declaration = alertsQueryDeclaration(src);
    expect(declaration, "requête déstructurée : l'état d'erreur est perdu").not.toMatch(/const\s*\{/);
    const name = declaration.match(/const\s+(\w+)\s*=/)?.[1];
    expect(name).toBeTruthy();
    expect(src).toMatch(new RegExp(`listQueryView(<[^>]*>)?\\(${name}\\)`));
  });

  it("l'erreur est affichée", () => {
    for (const pattern of shows) expect(src).toMatch(pattern);
  });

  it("aucun compte d'alertes replié à zéro", () => {
    expect(src).not.toMatch(/Array\.isArray\(\w*[aA]lerts\w*\)\s*\?\s*\w+\.length\s*:\s*0/);
  });
});
