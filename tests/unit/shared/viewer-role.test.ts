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
  "DRIVER_DIRECTORY_READ_ROLES",
  "MISSION_POD_READ_ROLES",
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
    // READ_ONLY_ROLES est le groupe propre du lecteur, pas un groupe de droits.
    expect(groupsWithViewer).toEqual([...STAFF_DERIVED_GROUPS, "READ_ONLY_ROLES"].sort());
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

  it("en écriture, seuls la session et le libre-service sur sa propre ligne restent ouverts", () => {
    expect(roles.VIEWER_WRITE_ALLOWED.map((a) => `${a.method} ${a.path}`)).toEqual([
      "POST /auth/login",
      "POST /auth/pin-login",
      "POST /auth/logout",
      "POST /users/change-password",
      "PATCH /onboarding/step",
      "PATCH /onboarding/complete",
      "PATCH /onboarding/mascot",
      "PATCH /notifications/settings",
      "PATCH /alerts/:id/read",
    ]);
    expect(roles.matchesAllowedWrite("PATCH", "/alerts/12/read")).toBe(true);
    expect(roles.matchesAllowedWrite("PATCH", "/alerts/12/read/")).toBe(true);
    expect(roles.matchesAllowedWrite("PATCH", "/alerts//read")).toBe(false);
    expect(roles.matchesAllowedWrite("DELETE", "/alerts/12")).toBe(false);
    expect(roles.matchesAllowedWrite("POST", "/alerts/read-all")).toBe(false);
    expect(roles.matchesAllowedWrite("post", "/auth/logout")).toBe(true);
    // Cas piégés : casse, double barre, segment en plus, traversée, point-virgule, autre méthode.
    for (const [method, path] of [
      ["PATCH", "/Alerts/1/read"],
      ["PATCH", "//alerts/1/read"],
      ["PATCH", "/alerts/1/read/x"],
      ["PATCH", "/alerts/1/read/../x"],
      ["POST", "/auth/logout;x"],
      ["PUT", "/alerts/1/read"],
    ]) {
      expect(roles.matchesAllowedWrite(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("est le seul rôle en lecture seule", () => {
    expect(roles.READ_ONLY_ROLES).toEqual(["viewer"]);
    expect(roles.isReadOnlyRole("viewer")).toBe(true);
    for (const stored of [" Viewer ", "LECTEUR", "lecteur"]) expect(roles.isReadOnlyRole(stored), stored).toBe(true);
    expect(roles.isReadOnlyRole("Comptable")).toBe(false);
    expect(roles.isReadOnlyRole(undefined)).toBe(false);
    for (const role of roles.ALL_APP_ROLES.filter((r) => r !== "viewer")) expect(roles.isReadOnlyRole(role)).toBe(false);
  });
});
