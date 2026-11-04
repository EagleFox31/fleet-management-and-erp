import { describe, expect, it } from "vitest";
import { ApiError, parseApiError } from "@/lib/api-error";
import { vehicleUnavailable } from "@/lib/vehicle-load-error";

const apiError = (status: number, text: string, requestId?: string) =>
  new ApiError(status, parseApiError(status, text, requestId).message, null, parseApiError(status, text, requestId));

/** #255 / #261 : seul un 404 (ou une réponse vide) dit « n'existe pas ». */
describe("vehicleUnavailable", () => {
  it("403 : accès refusé, avec le message du serveur", () => {
    const state = vehicleUnavailable(new ApiError(403, "Accès non autorisé à ce véhicule", null));
    expect(state).toEqual({ kind: "forbidden", title: "Accès refusé", message: "Accès non autorisé à ce véhicule", retryable: false });
  });

  it("404 : véhicule non trouvé", () => {
    const state = vehicleUnavailable(new ApiError(404, "Véhicule non trouvé", null));
    expect(state.kind).toBe("notFound");
    expect(state.title).toBe("Véhicule non trouvé");
    expect(state.message).toMatch(/n'existe pas/);
    expect(state.retryable).toBe(false);
  });

  it("sans erreur (réponse vide) : véhicule non trouvé", () => {
    expect(vehicleUnavailable(undefined).kind).toBe("notFound");
  });

  it("5xx : chargement impossible, relançable, avec la référence, jamais « n'existe pas »", () => {
    const state = vehicleUnavailable(apiError(500, '{"message":"Erreur interne","requestId":"req-42"}'));
    expect(state.kind).toBe("failed");
    expect(state.title).toBe("Chargement impossible");
    expect(state.retryable).toBe(true);
    expect(state.message).toContain("Référence : req-42");
    expect(state.message).not.toMatch(/n'existe pas/);
  });

  it("5xx sans corps : référence lue dans l'en-tête x-request-id", () => {
    expect(vehicleUnavailable(apiError(502, "Bad Gateway", "hdr-7")).message).toContain("Référence : hdr-7");
  });

  it("erreur réseau : message réseau, relançable", () => {
    const state = vehicleUnavailable(new TypeError("Failed to fetch"));
    expect(state.kind).toBe("failed");
    expect(state.retryable).toBe(true);
    expect(state.message).toMatch(/Connexion au serveur impossible/);
  });

  it("exception technique : repli générique, sans le texte technique", () => {
    const state = vehicleUnavailable(new Error("Cannot read properties of undefined (reading 'id')"));
    expect(state.kind).toBe("failed");
    expect(state.message).toBe("Chargement impossible, réessayez.");
  });
});
