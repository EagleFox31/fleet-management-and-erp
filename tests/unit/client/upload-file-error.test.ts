import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFile } from "@/lib/api";
import { isApiError, userMessageOf } from "@/lib/api-error";
import { clientLogger } from "@/lib/logger";

/** L'écran d'import de documents affiche le message normalisé du serveur, pas le corps brut. */
describe("uploadFile : réponse en erreur", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lève une ApiError portant le message du serveur", async () => {
    const message = "Accès refusé : cet élément n'appartient pas à votre compte.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message, code: "FORBIDDEN", requestId: "r1" }), { status: 403, headers: { "content-type": "application/json" } })),
    );
    vi.spyOn(clientLogger, "error").mockImplementation(() => undefined);

    const error = await uploadFile("/api/workflows/s/documents", new FormData()).catch((e) => e);

    expect(isApiError(error, 403)).toBe(true);
    expect(userMessageOf(error, "repli")).toBe(message);
    expect(error.message).not.toContain("{");
  });
});
