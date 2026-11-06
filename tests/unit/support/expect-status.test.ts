import { describe, expect, it } from "vitest";
import { describeResponseBody, expectStatus } from "../../support/expect-status";

describe("expectStatus", () => {
  it("statut attendu : rend la réponse telle quelle", () => {
    const response = { status: 200, body: { id: 7 } };
    expect(expectStatus(response, 200)).toBe(response);
  });

  it("statut inattendu : le message porte le corps et le libellé", () => {
    const response = { status: 404, body: { message: "Fonctionnalité désactivée.", code: "NOT_FOUND" } };
    expect(() => expectStatus(response, 200)).toThrow(/"message":"Fonctionnalité désactivée\."/);
    expect(() => expectStatus(response, 200, "admin")).toThrow(/^admin : /);
    expect(() => expectStatus(response, 200)).toThrow(/expected 404 to be 200/);
  });

  it("corps absent, texte, cyclique ou trop long : message lisible, jamais d'exception parasite", () => {
    expect(describeResponseBody(null)).toBe("null");
    expect(describeResponseBody(undefined)).toBe("undefined");
    expect(describeResponseBody("<html>502</html>")).toBe("<html>502</html>");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeResponseBody(cyclic)).toBe("[object Object]");
    const long = describeResponseBody({ text: "x".repeat(5000) });
    expect(long.length).toBeLessThan(2100);
    expect(long).toMatch(/… \(\d+ caractères\)$/);
  });
});
