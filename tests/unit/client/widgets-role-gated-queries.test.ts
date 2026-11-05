import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES, canReadClientBilling, canReadDocumentation } from "@shared/constants/roles";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

describe("widgets : requêtes limitées aux rôles admis par la route serveur", () => {
  it("statistiques de facturation : admin, secrétaire, logistique seulement", () => {
    const admitted = ALL_APP_ROLES.filter((r) => canReadClientBilling(r));
    expect([...admitted].sort()).toEqual(["admin", "logistics", "secretary"]);
    expect(canReadClientBilling("management")).toBe(false);
    expect(canReadClientBilling(undefined)).toBe(false);
  });

  it("documentation : admin seul (route isAdmin)", () => {
    expect(ALL_APP_ROLES.filter((r) => canReadDocumentation(r))).toEqual(["admin"]);
    expect(canReadDocumentation("secretary")).toBe(false);
  });

  it("le graphique CA client n'émet la requête que pour un rôle admis", () => {
    const src = read("client/src/components/dashboard/client-revenue-chart.tsx");
    expect(src).toMatch(/enabled:\s*allowed/);
    expect(src).toMatch(/allowed\s*=\s*canReadClientBilling\(/);
    expect(src).toMatch(/if \(!allowed\) return null/);
  });

  it("la page rapports garde /api/documentation derrière canReadDocumentation", () => {
    const src = read("client/src/pages/reports/index.tsx");
    expect(src).toMatch(/queryKey:\s*\['\/api\/documentation'\],\s*enabled:\s*canReadDocumentation\(/);
  });

  it("aucune requête vers les endpoints inexistants", () => {
    for (const file of [
      "client/src/hooks/useOperations.ts",
      "client/src/services/operationsService.ts",
      "client/src/components/charts/fuel-consumption-chart.tsx",
    ]) {
      const src = read(file);
      expect(src).not.toContain("/api/operations/stats/summary");
      expect(src).not.toContain("/api/fuel-card/consumption-history");
    }
  });
});
