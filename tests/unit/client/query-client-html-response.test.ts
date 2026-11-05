import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, INVALID_API_RESPONSE_MESSAGE } from "@/lib/queryClient";
import { clientLogger } from "@/lib/logger";
import { userMessageOf } from "@/lib/api-error";

/** Une route /api qui répond du HTML ne doit pas montrer l'URL ni l'extrait à l'utilisateur. */
describe("apiRequest : réponse HTML sur /api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lève un message sans jargon et journalise le détail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html><body>Boom</body></html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    const log = vi.spyOn(clientLogger, "error").mockImplementation(() => undefined);

    const error = await apiRequest("GET", "/api/vehicles").catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(INVALID_API_RESPONSE_MESSAGE);
    expect(error.message).not.toMatch(/api\/vehicles|html|doctype|backend/i);
    expect(userMessageOf(error, "repli")).toBe(INVALID_API_RESPONSE_MESSAGE);
    expect(log).toHaveBeenCalledWith("Réponse API invalide (HTML)", expect.objectContaining({ url: "/api/vehicles", htmlPreview: expect.stringContaining("doctype") }));
  });
});
