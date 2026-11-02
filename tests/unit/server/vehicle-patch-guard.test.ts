import { describe, expect, it } from "vitest";
import { vehiclePatchRefusal, VEHICLE_TANK_CAPACITY_ONLY_MESSAGE } from "../../../server/lib/vehicle-patch-guard";

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
