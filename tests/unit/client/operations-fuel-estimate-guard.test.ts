import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Opérations, onglets Clients et Destinations. `estimatedFuelCost` (ex-`totalRevenue`) de
 * `/api/operations/stats/*` est un carburant estimé, pas un chiffre d'affaires (décision du 2026-11-09) :
 * aucun « CA », « Marge » ni « Bénéfice » n'en est tiré. Une lecture en échec n'est jamais un 0 ni un vide.
 */
const panel = readFileSync(new URL("../../../client/src/components/operations/clients-panel.tsx", import.meta.url), "utf8");
const chart = readFileSync(new URL("../../../client/src/components/operations/destinations-chart.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../../client/src/services/operationsService.ts", import.meta.url), "utf8");

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("opérations : carburant estimé jamais présenté comme chiffre d'affaires", () => {
  for (const [name, src] of [["clients-panel", panel], ["destinations-chart", chart]] as const) {
    it(`${name} : ni CA, ni marge, ni bénéfice ; champs dépréciés jamais lus`, () => {
      expect(code(src)).not.toMatch(/\bCA\b|Marge|Bénéfice|Revenu|Chiffre d'affaires/);
      expect(code(src)).not.toMatch(/\.(totalRevenue|margin|marginPercentage|totalCost)\b/);
    });
  }

  it("types client : champs dépréciés et totalCost (jamais servi) retirés", () => {
    const types = service.slice(service.indexOf("export interface ClientSummary"), service.indexOf("export interface MissionCosts"));
    expect(code(types)).not.toMatch(/\b(totalRevenue|margin|marginPercentage|totalCost)\b/);
    expect(types).toMatch(/estimatedFuelCost: number \| null/);
    expect(service).toMatch(/getStatsByDestination\(\): Promise<DestinationStats\[\]>/);
  });
});

describe("clients-panel : une lecture en échec n'est ni « aucun client » ni 0", () => {
  it("statistiques à zéro par défaut supprimées", () => {
    expect(panel).not.toMatch(/EMPTY_CLIENT_STATS/);
    expect(panel).not.toMatch(/data: statsByClient = \[\]|data: clients = \[\]/);
  });

  it("liste et statistiques passent par listQueryView, chacune avec son encart d'erreur", () => {
    expect(panel.match(/listQueryView</g)?.length).toBe(2);
    expect(panel).toMatch(/data-testid="clients-list-error"/);
    expect(panel).toMatch(/data-testid="clients-stats-error"/);
  });

  it("compteurs des filtres masqués tant que la liste n'est pas lue", () => {
    expect(panel).not.toMatch(/\(\{(activeClientsCount|archivedClientsCount|totalClientsCount)\}\)/);
    expect(panel).toMatch(/countLabel\(activeClientsCount\)/);
  });
});
