import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les pages des écrans CDC sont chargées par `lazy()` (client/src/config/cdc-screen-components.ts).
 * React 18 exige alors une frontière `Suspense` au-dessus : sans elle, le premier rendu d'un écran
 * lève une erreur et le dépôt n'en avait aucune (revue de la PR #59).
 */
const source = readFileSync(resolve(__dirname, "../../../client/src/components/lot-routes.tsx"), "utf8").replace(/\r\n/g, "\n");
const components = readFileSync(resolve(__dirname, "../../../client/src/config/cdc-screen-components.ts"), "utf8");

describe("lot-routes : frontière Suspense", () => {
  it("les écrans CDC sont bien chargés paresseusement", () => {
    expect(components).toMatch(/lazy\(\(\) => import\(/);
  });

  it("Suspense est importé de React", () => {
    expect(source).toMatch(/import \{[^}]*\bSuspense\b[^}]*\} from "react"/);
  });

  it("le composant de l'écran est rendu à l'intérieur d'un <Suspense fallback=...>", () => {
    const open = source.indexOf("<Suspense");
    const close = source.indexOf("</Suspense>");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const inside = source.slice(open, close);
    expect(inside).toContain("fallback=");
    expect(inside).toMatch(/<Screen\b|<Component\b|createElement/);
  });
});
