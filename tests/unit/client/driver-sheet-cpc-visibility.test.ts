import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES, DRIVER_MANAGER_ROLES, canManageDrivers } from "@shared/constants/roles";

// La fiche chauffeur affiche CPCUpdateForm sous `canManageDrivers(role)`,
// la même source que le middleware `isDriverManager` de POST /api/drivers/:id/update-cpc.
describe("Fiche chauffeur : visibilité de la mise à jour CPC", () => {
  it.each(["admin", "logistics", "secretary"])("%s voit le formulaire", (role) => {
    expect(canManageDrivers(role)).toBe(true);
  });

  it.each(["driver", "client", "workshop_manager", "warehouse", "technician"])(
    "%s ne le voit pas",
    (role) => {
      expect(canManageDrivers(role)).toBe(false);
    },
  );

  it("n'est visible que pour les rôles gestionnaires, sur tous les rôles de l'application", () => {
    for (const role of ALL_APP_ROLES) {
      expect(canManageDrivers(role)).toBe((DRIVER_MANAGER_ROLES as readonly string[]).includes(role));
    }
  });

  it("refuse un rôle absent", () => {
    expect(canManageDrivers(undefined)).toBe(false);
    expect(canManageDrivers(null)).toBe(false);
  });
});
