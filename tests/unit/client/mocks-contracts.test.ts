import { describe, expect, it } from "vitest";
import { createMockStore } from "@/mocks/fixtures";
import { MOCK_ROUTES } from "@/mocks/routes";

describe("mocks msw : chaque réponse respecte son schéma de contrat", () => {
  for (const route of MOCK_ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path}`, () => {
      const reply = route.handle({
        params: route.sample?.params ?? {},
        query: route.sample?.query ?? {},
        body: route.sample?.body,
        store: createMockStore(),
        scenario: "normal",
      });
      expect(reply.status ?? 200).toBeLessThan(400);
      const parsed = route.response.safeParse(reply.body);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    });

    it(`${route.id} : scénario liste vide conforme`, () => {
      const reply = route.handle({
        params: route.sample?.params ?? {},
        query: route.sample?.query ?? {},
        body: route.sample?.body,
        store: createMockStore(),
        scenario: "empty",
      });
      if ((reply.status ?? 200) < 400) expect(route.response.safeParse(reply.body).success).toBe(true);
    });
  }

  it("aucune route déclarée deux fois", () => {
    const keys = MOCK_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
