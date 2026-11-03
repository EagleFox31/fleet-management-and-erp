import { describe, expect, it } from "vitest";
import { vehiclePatchRefusal, vehiclePriceWriteRefusal, VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE, VEHICLE_TANK_CAPACITY_ONLY_MESSAGE } from "../../../server/lib/vehicle-patch-guard";

describe("vehiclePatchRefusal", () => {
  it.each(["admin", "workshop_manager"])("%s : tout champ permis", (role) => {
    expect(vehiclePatchRefusal(role, { notes: "x", tankCapacityL: 50 })).toBeNull();
    expect(vehiclePatchRefusal(role, {})).toBeNull();
  });

  it("logistique : la capacité seule", () => {
    expect(vehiclePatchRefusal("logistics", { tankCapacityL: 80 })).toBeNull();
    expect(vehiclePatchRefusal("logistics", { tankCapacityL: null })).toBeNull();
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
    expect(err?.message).toBe(VEHICLE_TANK_CAPACITY_ONLY_MESSAGE);
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
