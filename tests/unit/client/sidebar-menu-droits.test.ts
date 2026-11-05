import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Le menu suit le droit de l'API, jamais plus large (docs/recette/profils-droits.html, ecarts 2 et 8).
const src = readFileSync("client/src/components/layout/sidebar.tsx", "utf8");
const bloc = (role: string) => {
  const i = src.indexOf(`case '${role}':`);
  const j = src.indexOf("case '", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
};

describe("menu lateral : entrees par role (ecarts de la carte des droits)", () => {
  it.each(["admin", "secretary", "logistics"])("%s voit Missions transport (ecrit par ADM, SEC, LOG)", (role) => {
    expect(bloc(role)).toContain('href: "/missions"');
  });
  it.each(["workshop_manager", "warehouse", "management", "technician", "client"])("%s n'a pas Missions transport", (role) => {
    expect(bloc(role)).not.toContain('href: "/missions"');
  });
  it("direction : Vehicules et Carburant (lecture API)", () => {
    expect(bloc("management")).toContain('href: "/vehicles"');
    expect(bloc("management")).toContain('href: "/fuel"');
  });
  it("magasinier : Rapports (rapport d'inventaire)", () => {
    expect(bloc("warehouse")).toContain('href: "/reports"');
  });
});
