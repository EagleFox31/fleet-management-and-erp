import { describe, expect, it } from "vitest";
import { canReadPartPrice, PART_PRICE_KEYS, redactPartPrice } from "../../../server/lib/part-price-scope";
import { STOCK_VALUATION_READ_ROLES } from "../../../shared/constants/roles";

describe("prix des pièces : redactPartPrice", () => {
  const body = {
    parts: [{ id: 1, reference: "R", unitPrice: "10.00", variants: [{ id: 2, additionalPrice: "3.00" }] }],
    total: 1,
    createdAt: new Date(0),
  };

  it("lecteurs = STOCK_VALUATION_READ_ROLES : ni chauffeur, ni client, ni rôle absent", () => {
    for (const role of STOCK_VALUATION_READ_ROLES) expect(canReadPartPrice(role), role).toBe(true);
    for (const role of ["driver", "client", "", null, undefined]) expect(canReadPartPrice(role)).toBe(false);
    expect(canReadPartPrice(" Warehouse ")).toBe(true);
  });

  it("chauffeur : retire les clés de prix à toute profondeur sans toucher l'entrée", () => {
    const out = redactPartPrice("driver", body);
    expect(JSON.stringify(out)).not.toMatch(new RegExp(PART_PRICE_KEYS.join("|")));
    expect(out.parts[0]).toEqual({ id: 1, reference: "R", variants: [{ id: 2 }] });
    expect(out.createdAt).toBe(body.createdAt);
    expect(body.parts[0].unitPrice).toBe("10.00");
  });

  it("magasinier : corps renvoyé tel quel", () => {
    expect(redactPartPrice("warehouse", body)).toBe(body);
  });
});
