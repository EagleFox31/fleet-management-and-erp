import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../server/lib/app-error";
import { OUT_OF_SCOPE_MESSAGE, canAccessOwned, ownerScopeOf } from "../../../server/lib/client-scope";
import { ALL_APP_ROLES } from "../../../shared/constants/roles";

/**
 * Cloison entre clients : le personnel voit tous les véhicules, un client ne
 * voit que les siens (`vehicles.ownerId`).
 */
const STAFF_ROLES = ALL_APP_ROLES.filter((role) => role !== "client");
const client = { id: 42, role: "client" };

describe("ownerScopeOf", () => {
  it("aucun filtre pour le personnel, quel que soit le rôle", () => {
    for (const role of STAFF_ROLES) {
      expect(ownerScopeOf({ id: 7, role })).toBeNull();
    }
  });

  it("impose l'id du client comme propriétaire", () => {
    expect(ownerScopeOf(client)).toBe(42);
  });

  it("sans utilisateur : 401, jamais une lecture sans filtre", () => {
    expect(() => ownerScopeOf(undefined)).toThrow(AppError);
    try {
      ownerScopeOf(undefined);
    } catch (error) {
      expect((error as AppError).status).toBe(401);
    }
  });
});

describe("canAccessOwned", () => {
  it("le personnel accède sans lire le propriétaire", async () => {
    const ownerOf = vi.fn(async () => 99);
    for (const role of STAFF_ROLES) {
      expect(await canAccessOwned({ id: 7, role }, ownerOf)).toBe(true);
    }
    expect(ownerOf).not.toHaveBeenCalled();
  });

  it("un client accède à son véhicule", async () => {
    expect(await canAccessOwned(client, async () => 42)).toBe(true);
  });

  it("un client est refusé sur le véhicule d'un autre client", async () => {
    expect(await canAccessOwned(client, async () => 43)).toBe(false);
  });

  it("un client est refusé sur un véhicule sans propriétaire ou inexistant", async () => {
    expect(await canAccessOwned(client, async () => null)).toBe(false);
    expect(await canAccessOwned(client, async () => undefined)).toBe(false);
  });

  it("sans utilisateur : refusé", async () => {
    expect(await canAccessOwned(undefined, async () => 42)).toBe(false);
  });
});

describe("OUT_OF_SCOPE_MESSAGE", () => {
  it("ne nomme pas l'objet : la même réponse sert pour un véhicule, un document et un identifiant absent", () => {
    expect(OUT_OF_SCOPE_MESSAGE).not.toMatch(/véhicule|document/i);
    expect(OUT_OF_SCOPE_MESSAGE).toMatch(/n'appartient pas à votre compte/);
  });
});
