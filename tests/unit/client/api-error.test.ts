import { describe, expect, it } from "vitest";
import { ApiError, isApiError, parseApiError, toApiError, userMessageOf } from "@/lib/api-error";
import { NETWORK_ERROR_MESSAGE, STATUS_MESSAGES } from "@shared/errors";

/** T3 niveau U : une erreur API devient une phrase lisible, jamais du technique. */
describe("parseApiError", () => {
  it("lit le contrat { message, code, requestId }", () => {
    const parsed = parseApiError(
      409,
      JSON.stringify({ message: "La demande a déjà changé de statut. Rechargez la page.", code: "CONFLICT", requestId: "abc123" }),
    );
    expect(parsed).toMatchObject({ message: "La demande a déjà changé de statut. Rechargez la page.", code: "CONFLICT", requestId: "abc123" });
  });

  it("comprend encore la forme historique { error }", () => {
    expect(parseApiError(404, JSON.stringify({ error: "Commande introuvable" })).message).toBe("Commande introuvable");
  });

  it("une 500 n'affiche jamais le message d'origine, mais donne la référence", () => {
    const parsed = parseApiError(500, JSON.stringify({ error: 'relation "parts" does not exist' }), "ref-42xy");
    expect(parsed.message).toBe(`${STATUS_MESSAGES.INTERNAL} Référence : ref-42xy.`);
    expect(parsed.message).not.toMatch(/relation|parts/);
  });

  it("n'affiche ni chemin de champ ni message Zod anglais", () => {
    const body = {
      error: "Données invalides",
      details: [{ code: "invalid_type", path: ["lines", 0, "quantity"], expected: "number", received: "string", message: "Expected number, received string" }],
    };
    const parsed = parseApiError(400, JSON.stringify(body));
    expect(parsed.message).toBe("Données invalides");
    expect(parsed.fieldErrors).toEqual([{ field: "lines.0.quantity", message: "Le format de ce champ n'est pas valide." }]);
  });

  it("précise un message générique par l'erreur de champ, traduite", () => {
    const body = { message: STATUS_MESSAGES.VALIDATION, errors: [{ field: "plateNumber", message: "Required", code: "invalid_type", received: "undefined" }] };
    expect(parseApiError(400, JSON.stringify(body)).message).toBe("Ce champ est obligatoire.");
  });

  it("remplace un message technique par le message du statut", () => {
    expect(parseApiError(400, JSON.stringify({ message: '[{"code":"invalid_type"}]' })).message).toBe(STATUS_MESSAGES.VALIDATION);
    expect(parseApiError(403, "Forbidden").message).toBe(STATUS_MESSAGES.FORBIDDEN);
  });

  it("une page HTML ou un corps vide donnent le message du statut", () => {
    expect(parseApiError(401, "").message).toBe(STATUS_MESSAGES.UNAUTHENTICATED);
    expect(parseApiError(404, "<html>Not found</html>").message).toBe(STATUS_MESSAGES.NOT_FOUND);
  });
});

describe("toApiError", () => {
  it("porte statut, code, référence et corps pour le développeur", async () => {
    const res = new Response(JSON.stringify({ message: "Accès non autorisé", code: "FORBIDDEN" }), {
      status: 403,
      headers: { "X-Request-Id": "req-777" },
    });
    const error = await toApiError(res);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", requestId: "req-777", message: "Accès non autorisé" });
    expect(error.body).toEqual({ message: "Accès non autorisé", code: "FORBIDDEN" });
  });
});

describe("userMessageOf", () => {
  it("ne montre jamais une exception JavaScript brute", () => {
    expect(userMessageOf(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(STATUS_MESSAGES.INTERNAL);
    expect(userMessageOf(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
    expect(userMessageOf(undefined, "Chargement impossible.")).toBe("Chargement impossible.");
  });

  it("garde un message métier rédigé en français", () => {
    expect(userMessageOf(new Error("Stock insuffisant pour cette pièce"))).toBe("Stock insuffisant pour cette pièce");
  });
});

describe("isApiError", () => {
  it("filtre par statut", () => {
    const error = new ApiError(401, "Session expirée", null);
    expect(isApiError(error)).toBe(true);
    expect(isApiError(error, 401)).toBe(true);
    expect(isApiError(error, 404)).toBe(false);
    expect(isApiError(new Error("401: Non authentifié"), 401)).toBe(false);
  });
});
