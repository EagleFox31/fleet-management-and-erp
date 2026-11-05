import { describe, expect, it } from "vitest";
import { canManageDrivers } from "../../../shared/constants/roles";

/** Le formulaire de mise à jour CPC n'est montré qu'aux rôles acceptés par POST /api/drivers/:id/update-cpc. */
describe("visibilité de la mise à jour CPC", () => {
  it.each(["admin", "logistics", "secretary"])("%s la voit", (role) => {
    expect(canManageDrivers(role)).toBe(true);
  });
  it.each(["workshop_manager", "technician", "warehouse", "client", "", null, undefined])("%s ne la voit pas", (role) => {
    expect(canManageDrivers(role as string | null | undefined)).toBe(false);
  });
});
