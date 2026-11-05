import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUEL_CARD_MANAGER_ROLES, FUEL_RECHARGE_SOURCE_ROLES, TREASURY_WRITE_ROLES } from "../../../shared/constants/roles";

// Dérogation du 5 novembre 2026 : qui peut débiter une banque ou une caisse pour recharger la carte.
// La liste ne bouge que sur décision explicite, consignée dans docs/journal/tresorerie-t2t3-journal.md.

describe("FUEL_RECHARGE_SOURCE_ROLES : dérogation nommée", () => {
  it("admin, secrétariat, logistique, et rien d'autre", () => {
    expect([...FUEL_RECHARGE_SOURCE_ROLES].sort()).toEqual(["admin", "logistics", "secretary"]);
  });

  it("sous-ensemble des gestionnaires de carte : la route est gardée par isFuelCardManager d'abord", () => {
    for (const role of FUEL_RECHARGE_SOURCE_ROLES) expect(FUEL_CARD_MANAGER_ROLES as readonly string[], role).toContain(role);
  });

  it("la logistique est la seule exception à TREASURY_WRITE_ROLES", () => {
    const outside = FUEL_RECHARGE_SOURCE_ROLES.filter((role) => !(TREASURY_WRITE_ROLES as readonly string[]).includes(role));
    expect(outside).toEqual(["logistics"]);
  });

  it("la route contrôle le rôle avant de lire l'identifiant du compte source", () => {
    const src = readFileSync("server/api/fuel-card.routes.ts", "utf8");
    const guard = src.indexOf("FUEL_RECHARGE_SOURCE_ROLES as readonly string[]).includes");
    const parse = src.indexOf("sourceAccountIdSchema.safeParse");
    expect(guard).toBeGreaterThan(0);
    expect(parse).toBeGreaterThan(guard);
  });
});
