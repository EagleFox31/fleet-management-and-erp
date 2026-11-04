import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQueryUrl, getQueryFn } from "@/lib/queryClient";

/**
 * URL appelée par la queryFn par défaut selon la forme de la clé (#285).
 * Avant #285, seul `queryKey[1]` était lu, comme objet : `['/api/vehicles', 5]` appelait la liste,
 * `['/api/documentation', 'GUIDE.md']` appelait `?0=G&1=U...`.
 */
describe("buildQueryUrl", () => {
  it("[url] : l'URL seule", () => {
    expect(buildQueryUrl(["/api/vehicles"])).toBe("/api/vehicles");
  });

  it("[url, objet] : chaîne de requête, undefined omis", () => {
    expect(buildQueryUrl(["/api/vehicles", { status: "active", page: 2, q: undefined }])).toBe(
      "/api/vehicles?status=active&page=2",
    );
    expect(buildQueryUrl(["/api/vehicles", {}])).toBe("/api/vehicles");
  });

  it("[url, scalaire] : segment de chemin encodé", () => {
    expect(buildQueryUrl(["/api/vehicles", 5])).toBe("/api/vehicles/5");
    expect(buildQueryUrl(["/api/documentation", "GUIDE_UTILISATEUR.md"])).toBe("/api/documentation/GUIDE_UTILISATEUR.md");
    expect(buildQueryUrl(["/api/vehicles/registration", "LT 123/AB"])).toBe("/api/vehicles/registration/LT%20123%2FAB");
    expect(buildQueryUrl(["/api/fuel-card/vehicle", 7, "stats"])).toBe("/api/fuel-card/vehicle/7/stats");
  });

  it("[url, scalaire, objet] : segments puis chaîne de requête", () => {
    expect(buildQueryUrl(["/api/suppliers", 3, "invoices", { status: "paid" }])).toBe("/api/suppliers/3/invoices?status=paid");
  });

  it("ignore ce qui suit l'objet, et saute null, undefined, booléens et chaîne vide", () => {
    expect(buildQueryUrl(["/api/parts", { limit: 5 }, "extra", 9])).toBe("/api/parts?limit=5");
    expect(buildQueryUrl(["/api/parts", null, undefined, true, ""])).toBe("/api/parts");
  });
});

describe("getQueryFn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [["/api/vehicles"], "/api/vehicles"],
    [["/api/vehicles", { status: "active" }], "/api/vehicles?status=active"],
    [["/api/vehicles", 5], "/api/vehicles/5"],
    [["/api/suppliers", 3, "invoices", { status: "paid" }], "/api/suppliers/3/invoices?status=paid"],
  ])("%j appelle %s", async (queryKey, expected) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await getQueryFn({ on401: "throw" })({ queryKey, meta: undefined, signal: new AbortController().signal } as never);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(new RegExp(`${expected.replace(/[.?/]/g, "\\$&")}$`));
  });
});
