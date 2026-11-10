import { describe, expect, it } from "vitest";
import * as roles from "@shared/constants/roles";

/**
 * Lecteur (`viewer`) : du personnel, lecture seule, aucune donnée personnelle.
 * Le lecteur ne figure que dans les groupes dérivés du personnel entier (lecture, événements
 * temps réel). Toute autre apparition est à justifier ici : c'est un droit d'écrire ou de lire
 * une donnée réservée.
 */
const STAFF_DERIVED_GROUPS = [
  "ALL_APP_ROLES",
  "STAFF_ROLES",
  "STOCK_VALUATION_READ_ROLES",
  "WORK_ORDER_COST_READ_ROLES",
  "VEHICLE_DOCUMENT_EVENT_ROLES",
  "MISSION_EVENT_ROLES",
  "PART_CATALOG_EVENT_ROLES",
  "OPERATIONS_COST_READ_ROLES",
].sort();

describe("rôle lecteur (viewer)", () => {
  it("libellé Lecteur, membre du personnel", () => {
    expect(roles.ROLE_LABELS.viewer).toBe("Lecteur");
    expect(roles.STAFF_ROLES).toContain("viewer");
  });

  it("n'entre dans aucun groupe de rôles hors ceux dérivés du personnel entier", () => {
    const groupsWithViewer = Object.entries(roles)
      .filter(([name, value]) => name.endsWith("_ROLES") && Array.isArray(value) && (value as readonly string[]).includes("viewer"))
      .map(([name]) => name)
      .sort();
    expect(groupsWithViewer).toEqual(STAFF_DERIVED_GROUPS);
  });

  it("ne lit pas les données personnelles des chauffeurs (CNI, permis)", () => {
    expect(roles.canReadDriverPersonalData("viewer")).toBe(false);
    expect(roles.DRIVER_PERSONAL_DATA_READER_ROLES).not.toContain("viewer");
  });

  it("n'administre rien : utilisateurs, chauffeurs, stock, missions, finances", () => {
    expect(roles.canManageDrivers("viewer")).toBe(false);
    for (const fn of [roles.canReadClientBilling, roles.canReadFinanceReceivable, roles.canReadDocumentation]) {
      expect(fn("viewer"), fn.name).toBe(false);
    }
  });

  it("seule la fermeture de session reste ouverte en écriture", () => {
    expect(roles.VIEWER_WRITE_ALLOWED).toEqual([{ method: "POST", path: "/auth/logout" }]);
  });
});
