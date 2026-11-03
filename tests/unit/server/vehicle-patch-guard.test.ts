import { describe, expect, it } from "vitest";
import { isEmptyPurchasePrice, vehiclePatchRefusal, vehiclePriceWriteRefusal, vehicleRestrictedPatchMessage, withoutEmptyPurchasePrice, VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE } from "../../../server/lib/vehicle-patch-guard";

describe("vehiclePatchRefusal", () => {
  it.each(["admin", "workshop_manager"])("%s : tout champ permis", (role) => {
    expect(vehiclePatchRefusal(role, { notes: "x", tankCapacityL: 50 })).toBeNull();
    expect(vehiclePatchRefusal(role, {})).toBeNull();
  });

  it("logistique : la capacité et le prix d'achat, rien d'autre", () => {
    expect(vehiclePatchRefusal("logistics", { tankCapacityL: 80 })).toBeNull();
    expect(vehiclePatchRefusal("logistics", { tankCapacityL: null })).toBeNull();
    expect(vehiclePatchRefusal("logistics", { purchasePrice: 5 })).toBeNull();
    expect(vehiclePatchRefusal("logistics", { tankCapacityL: 80, purchasePrice: 5 })).toBeNull();
  });

  it("secrétariat : le prix d'achat seul", () => {
    expect(vehiclePatchRefusal("secretary", { purchasePrice: 5 })).toBeNull();
    for (const body of [{ purchasePrice: 5, notes: "x" }, { notes: "x" }, { tankCapacityL: 80 }, {}, undefined]) {
      const err = vehiclePatchRefusal("secretary", body);
      expect(err?.status).toBe(403);
      expect(err?.message).toBe(vehicleRestrictedPatchMessage("secretary"));
    }
  });

  it.each([
    [{ tankCapacityL: 80, notes: "x" }],
    [{ notes: "x" }],
    [{}],
    [undefined],
    [null],
    [["tankCapacityL"]],
  ])("logistique %j : 403 lisible", (body) => {
    const err = vehiclePatchRefusal("logistics", body);
    expect(err?.status).toBe(403);
    expect(err?.message).toBe(vehicleRestrictedPatchMessage("logistics"));
  });

  it("rôle inconnu ou absent : refusé comme la logistique", () => {
    expect(vehiclePatchRefusal(undefined, { notes: "x" })?.status).toBe(403);
  });
});

describe("vehiclePriceWriteRefusal", () => {
  it.each(["admin", "logistics", "secretary"])("%s : peut écrire le prix", (role) => {
    expect(vehiclePriceWriteRefusal(role, { purchasePrice: 1 })).toBeNull();
  });

  it.each(["workshop_manager", "management", "technician", "warehouse", "client", "driver", undefined])(
    "%s : 403 lisible si purchasePrice est envoyé",
    (role) => {
      const err = vehiclePriceWriteRefusal(role, { purchasePrice: 1 });
      expect(err?.status).toBe(403);
      expect(err?.message).toBe(VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE);
    },
  );

  it("sans la clé purchasePrice : aucun refus, quel que soit le rôle", () => {
    expect(vehiclePriceWriteRefusal("workshop_manager", { notes: "x" })).toBeNull();
    expect(vehiclePriceWriteRefusal("workshop_manager", undefined)).toBeNull();
  });
});

describe("isEmptyPurchasePrice / withoutEmptyPurchasePrice", () => {
  it.each([[undefined], [null], [""], ["  "], [0], ["0"], ["0.00"]])("%j : vide", (value) => {
    expect(isEmptyPurchasePrice(value)).toBe(true);
  });
  it.each([[1], ["1"], ["abc"], [0.5], [-1], [false]])("%j : non vide", (value) => {
    expect(isEmptyPurchasePrice(value)).toBe(false);
  });

  it("retire la clé vide pour un rôle sans droit, sans modifier l'original", () => {
    const body = { purchasePrice: 0, notes: "x" };
    expect(withoutEmptyPurchasePrice("workshop_manager", body)).toEqual({ notes: "x" });
    expect(body).toEqual({ purchasePrice: 0, notes: "x" });
  });

  it("garde une valeur non nulle (refusée ensuite en 403)", () => {
    const body = { purchasePrice: 5 };
    expect(withoutEmptyPurchasePrice("workshop_manager", body)).toBe(body);
  });

  it.each(["admin", "logistics", "secretary"])("%s : corps inchangé même à 0", (role) => {
    const body = { purchasePrice: 0 };
    expect(withoutEmptyPurchasePrice(role, body)).toBe(body);
  });
});
