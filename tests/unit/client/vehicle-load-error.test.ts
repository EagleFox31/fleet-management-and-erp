import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { vehicleUnavailable } from "@/lib/vehicle-load-error";

/** #255 : un véhicule hors périmètre (403) ne s'affiche pas comme un véhicule inexistant (404). */
describe("vehicleUnavailable", () => {
  it("403 : accès refusé, avec le message du serveur", () => {
    const state = vehicleUnavailable(new ApiError(403, "Accès non autorisé à ce véhicule", null));
    expect(state).toEqual({ forbidden: true, title: "Accès refusé", message: "Accès non autorisé à ce véhicule" });
    expect(state.message).not.toMatch(/n'existe pas/);
  });

  it("404 : véhicule non trouvé", () => {
    const state = vehicleUnavailable(new ApiError(404, "Véhicule non trouvé", null));
    expect(state.forbidden).toBe(false);
    expect(state.title).toBe("Véhicule non trouvé");
    expect(state.message).toMatch(/n'existe pas/);
  });

  it("sans erreur (réponse vide) : véhicule non trouvé", () => {
    expect(vehicleUnavailable(undefined).title).toBe("Véhicule non trouvé");
  });
});
