import { describe, expect, it } from "vitest";
import { normalizeScope, resolveRecipients, type ConnectionIndex } from "../../../server/lib/realtime-scope";

/**
 * Portée fermée par défaut (LESSONS_LEARNED, « Portée temps réel fermée par défaut »).
 * Avant : une portée invalide ou vide retombait en broadcast, client compris
 * (#53, #127, #151). Désormais : rien n'est envoyé, sauf `type: "broadcast"` explicite.
 */

// Index de connexions : sockets représentés par des chaînes.
const index: ConnectionIndex<string> = {
  byUser: new Map([
    [1, new Set(["admin-1"])],
    [2, new Set(["mag-2a", "mag-2b"])],
    [3, new Set(["client-3"])],
    [4, new Set(["tech-4"])],
  ]),
  byRole: new Map([
    ["admin", new Set(["admin-1"])],
    ["warehouse", new Set(["mag-2a", "mag-2b"])],
    ["client", new Set(["client-3"])],
    ["technician", new Set(["tech-4"])],
  ]),
};

const send = (scope: unknown, target: number | null = null) =>
  [...resolveRecipients(normalizeScope(scope, target), index)].sort();

describe("portée temps réel", () => {
  it("rôle : seulement les connexions de ce rôle (casse et espaces ignorés)", () => {
    expect(send({ type: "roles", roles: ["Warehouse "] })).toEqual(["mag-2a", "mag-2b"]);
  });

  it("userId : seulement ce compte, tous ses onglets", () => {
    expect(send({ type: "user", userIds: [2] })).toEqual(["mag-2a", "mag-2b"]);
  });

  it("combinaison de cibles : union des destinataires, sans doublon", () => {
    expect(send({ type: "user", userIds: [1, 4] })).toEqual(["admin-1", "tech-4"]);
    expect(send({ type: "roles", roles: ["admin", "technician"] })).toEqual(["admin-1", "tech-4"]);
  });

  it("un userId invalide est écarté, les valides restent", () => {
    expect(send({ type: "user", userIds: [null, 4, -1, 1.5, "2"] })).toEqual(["tech-4"]);
  });

  it("3e argument userId sans portée : ce compte seul", () => {
    expect(send(undefined, 4)).toEqual(["tech-4"]);
  });

  it("broadcast explicite : toutes les connexions", () => {
    expect(send({ type: "broadcast" })).toEqual(["admin-1", "client-3", "mag-2a", "mag-2b", "tech-4"]);
  });

  it("un client tiers n'est jamais atteint par une portée rôle ou user qui ne le vise pas", () => {
    for (const scope of [
      { type: "roles", roles: ["admin", "warehouse", "technician"] },
      { type: "user", userIds: [1, 2, 4] },
    ]) {
      expect(send(scope)).not.toContain("client-3");
    }
  });

  describe("portée invalide : aucun destinataire", () => {
    const invalids: Array<[string, unknown, number | null]> = [
      ["userIds vide", { type: "user", userIds: [] }, null],
      ["userIds [null]", { type: "user", userIds: [null] }, null],
      ["userIds absent", { type: "user" }, null],
      ["roles vide", { type: "roles", roles: [] }, null],
      ["roles de chaînes vides", { type: "roles", roles: ["", "  "] }, null],
      ["roles non texte", { type: "roles", roles: [null, 3] }, null],
      ["roles absent", { type: "roles" }, null],
      ["objet sans cible", {}, null],
      ["type inconnu", { type: "everyone" }, null],
      ["type en chaîne (scope: \"user\")", "user", null],
      ["tableau", [], null],
      ["aucune portée, aucun userId", undefined, null],
      ["null", null, null],
      ["userIds vide même avec un 3e argument", { type: "user", userIds: [] }, 3],
      ["roles vide même avec un 3e argument", { type: "roles", roles: [] }, 3],
    ];

    it.each(invalids)("%s", (_label, scope, target) => {
      expect(send(scope, target)).toEqual([]);
    });
  });

  it("aucune portée calculée vide n'atteint un client", () => {
    expect(send({ type: "user", userIds: [null] })).not.toContain("client-3");
    expect(send({ type: "roles", roles: [] })).not.toContain("client-3");
  });
});
