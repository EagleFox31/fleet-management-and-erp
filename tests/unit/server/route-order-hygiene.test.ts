import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { findParamBeforeLiteral, masks, servedRoutesInOrder, type OrderedRoute } from "../../support/route-order-scan";

/**
 * Garde issue de #222 (LESSONS_LEARNED, 3 novembre 2026) : `GET /api/suppliers/:id`
 * (`server/api/suppliers.routes.ts`, monté avant `routes.ts`) capturait `summary`, et
 * `GET /api/suppliers/summary` ne servait jamais.
 *
 * Toute route littérale masquée par un paramètre déclaré avant elle doit figurer ci-dessous, avec
 * sa raison (par exemple une garde chaînée qui passe la main par `next()`). Liste gelée en
 * égalité stricte, qui ne peut que rétrécir : vide le 3 novembre 2026. Sur le code d'avant #222,
 * le scan trouve exactement le défaut de #222.
 */
const PARAM_BEFORE_LITERAL_FROZEN: Record<string, string> = {};

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const routes = servedRoutesInOrder(serverDir);

describe("ordre des routes : aucun littéral masqué par un /:param déclaré avant lui", () => {
  it("le scan voit les routes servies, dans l'ordre (il n'est pas aveugle)", () => {
    expect(routes.length).toBeGreaterThan(300);
    const at = (path: string) => routes.findIndex((r) => r.method === "get" && r.path === path);
    expect(at("/api/suppliers/summary")).toBeGreaterThan(-1);
    expect(at("/api/suppliers/summary")).toBeLessThan(at("/api/suppliers/:id"));
  });

  it("aucun littéral masqué hors de la liste gelée (égalité stricte)", () => {
    expect(findParamBeforeLiteral(routes)).toEqual(Object.keys(PARAM_BEFORE_LITERAL_FROZEN));
  });

  it("chaque exception porte une justification", () => {
    for (const [key, reason] of Object.entries(PARAM_BEFORE_LITERAL_FROZEN)) expect(reason.length, key).toBeGreaterThan(20);
  });
});

describe("findParamBeforeLiteral", () => {
  const route = (method: string, path: string, origin = "a.ts"): OrderedRoute => ({ method, path, origin });

  it("motif de #222 : /:id d'un routeur monté avant, littéral de routes.ts ensuite", () => {
    expect(
      findParamBeforeLiteral([
        route("get", "/api/suppliers/:id", "server/api/suppliers.routes.ts"),
        route("get", "/api/suppliers/summary", "server/routes.ts"),
      ]),
    ).toEqual(["GET /api/suppliers/summary (server/routes.ts) <- GET /api/suppliers/:id (server/api/suppliers.routes.ts)"]);
  });

  it("même routeur : /:id puis /stats masqué ; /stats puis /:id servi", () => {
    expect(findParamBeforeLiteral([route("get", "/x/:id"), route("get", "/x/stats")])).toHaveLength(1);
    expect(findParamBeforeLiteral([route("get", "/x/stats"), route("get", "/x/:id")])).toEqual([]);
  });

  it("paramètre au milieu du chemin : /x/:id/items masque /x/export/items", () => {
    expect(findParamBeforeLiteral([route("patch", "/x/:id/items"), route("patch", "/x/export/items")])).toHaveLength(1);
  });

  it("pas de masquage : autre méthode, autre longueur, littéral différent, paramètres face à face, doublon", () => {
    expect(findParamBeforeLiteral([route("get", "/x/:id"), route("post", "/x/stats")])).toEqual([]);
    expect(findParamBeforeLiteral([route("get", "/x/:id"), route("get", "/x/stats/today")])).toEqual([]);
    expect(findParamBeforeLiteral([route("get", "/x/:id/a"), route("get", "/x/stats/b")])).toEqual([]);
    expect(findParamBeforeLiteral([route("get", "/x/:id"), route("get", "/x/:vehicleId")])).toEqual([]);
    expect(findParamBeforeLiteral([route("get", "/x/:id"), route("get", "/x/:id")])).toEqual([]);
  });

  it("paramètre contraint, optionnel ou joker : jamais jugé masquant (limite documentée)", () => {
    expect(masks("/x/:id(\\d+)", "/x/stats")).toBe(false);
    expect(masks("/x/:id?", "/x/stats")).toBe(false);
    expect(masks("/x/*", "/x/stats")).toBe(false);
  });

  it("barre finale ignorée", () => {
    expect(masks("/x/:id/", "/x/stats")).toBe(true);
  });
});
