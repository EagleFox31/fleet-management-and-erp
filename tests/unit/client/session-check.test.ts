import { describe, expect, it } from "vitest";
import { checkSession, nextSessionRetryDelay } from "@/lib/session-check";

const respond = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkSession : seul un 401 vaut déconnexion", () => {
  it("200 → session ouverte avec l'utilisateur", async () => {
    const result = await checkSession(respond(200, { id: 7, username: "magasin" }));
    expect(result).toEqual({ status: "authenticated", user: { id: 7, username: "magasin" } });
  });

  it("401 → anonyme", async () => {
    expect(await checkSession(respond(401))).toEqual({ status: "anonymous" });
  });

  it.each([403, 500, 502, 503])("%i → serveur injoignable, pas une déconnexion, avec le code HTTP", async (status) => {
    expect(await checkSession(respond(status))).toEqual({ status: "unreachable", httpStatus: status });
  });

  it("réseau coupé → injoignable", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await checkSession(failing)).toEqual({ status: "unreachable" });
  });

  it("délai dépassé → injoignable", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    expect(await checkSession(hanging, 20)).toEqual({ status: "unreachable" });
  });
});

describe("checkSession : 200 JSON qui n'est pas un utilisateur", () => {
  it.each([
    ["objet vide", {}],
    ["null", null],
    ["tableau", []],
    ["id absent", { username: "x" }],
    ["id en texte", { id: "7" }],
    ["id nul", { id: 0 }],
    ["id négatif", { id: -3 }],
    ["id décimal", { id: 1.5 }],
  ])("%s : injoignable avec httpStatus 200 (comme un 200 non JSON), jamais authentifié", async (_label, body) => {
    expect(await checkSession(respond(200, body))).toEqual({ status: "unreachable", httpStatus: 200 });
  });
});

describe("nextSessionRetryDelay", () => {
  it("double jusqu'à 10 s puis plafonne", () => {
    expect([1, 2, 3, 4, 5, 9].map(nextSessionRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });
});

describe("checkSession : une réponse HTTP n'est jamais un réseau coupé (C2)", () => {
  const html = (async () =>
    new Response("<html>portail</html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

  it("200 text/html : injoignable AVEC le code HTTP", async () => {
    expect(await checkSession(html)).toEqual({ status: "unreachable", httpStatus: 200 });
  });

  it("redirection (portail captif) : injoignable avec le code HTTP", async () => {
    const redirected = (async () => {
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    }) as unknown as typeof fetch;
    expect(await checkSession(redirected)).toEqual({ status: "unreachable", httpStatus: 200 });
  });
});
