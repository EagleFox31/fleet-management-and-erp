import { describe, expect, it } from "vitest";
import { canReadPurchasePrice, redactVehiclePrice, redactVehiclePriceDeep } from "../../../server/lib/vehicle-price-scope";
import { ALL_APP_ROLES, VEHICLE_PURCHASE_PRICE_READ_ROLES } from "../../../shared/constants/roles";

/**
 * Prix d'achat d'un véhicule : lisible par admin, logistique et secrétariat seulement
 * (décision du 3 novembre 2026). Tout autre rôle de `users.role.enumValues` le reçoit à `null`.
 */
const vehicle = { id: 1, registrationNumber: "TEST-AA-001", purchasePrice: "15000000.00", purchaseDate: new Date("2020-01-01") };

describe("VEHICLE_PURCHASE_PRICE_READ_ROLES", () => {
  it("est figée à admin, logistics, secretary", () => {
    expect([...VEHICLE_PURCHASE_PRICE_READ_ROLES].sort()).toEqual(["admin", "logistics", "secretary"]);
  });
});

describe("redactVehiclePrice", () => {
  it.each(VEHICLE_PURCHASE_PRICE_READ_ROLES)("%s garde la valeur (même objet)", (role) => {
    expect(redactVehiclePrice({ role }, vehicle)).toBe(vehicle);
  });

  it("tout autre rôle reçoit purchasePrice à null, le reste est intact", () => {
    const others = ALL_APP_ROLES.filter((role) => !(VEHICLE_PURCHASE_PRICE_READ_ROLES as readonly string[]).includes(role));
    expect(others.length).toBe(ALL_APP_ROLES.length - 3);
    for (const role of others) {
      const out = redactVehiclePrice({ role }, vehicle);
      expect(out.purchasePrice).toBeNull();
      expect(out.registrationNumber).toBe(vehicle.registrationNumber);
      expect(out.purchaseDate).toBe(vehicle.purchaseDate);
    }
  });

  it("n'altère pas l'entrée", () => {
    redactVehiclePrice({ role: "driver" }, vehicle);
    expect(vehicle.purchasePrice).toBe("15000000.00");
  });

  it("lecteur absent ou rôle inconnu : échec fermé", () => {
    expect(redactVehiclePrice(undefined, vehicle).purchasePrice).toBeNull();
    expect(redactVehiclePrice(null, vehicle).purchasePrice).toBeNull();
    expect(redactVehiclePrice({ role: "inconnu" }, vehicle).purchasePrice).toBeNull();
    expect(canReadPurchasePrice({ role: undefined })).toBe(false);
  });

  it("objet sans purchasePrice, null ou undefined : rendu tel quel", () => {
    const sans = { id: 2 };
    expect(redactVehiclePrice({ role: "driver" }, sans)).toBe(sans);
    expect(redactVehiclePrice({ role: "driver" }, null)).toBeNull();
    expect(redactVehiclePrice({ role: "driver" }, undefined)).toBeUndefined();
  });
});

describe("redactVehiclePriceDeep", () => {
  const mission = { id: 9, vehicle, assignment: { vehicle, driver: { id: 3 } }, startedAt: new Date("2026-01-01") };
  const page = { vehicles: [vehicle, { ...vehicle, id: 2 }], total: 2 };
  const tire = { id: 5, brand: "X", purchasePrice: "80000.00" };

  it("expurge liste, page et jointures imbriquées", () => {
    const out = redactVehiclePriceDeep({ role: "technician" }, { page, missions: [mission] });
    expect(out.page.vehicles.every((v) => v.purchasePrice === null)).toBe(true);
    expect(out.missions[0].vehicle.purchasePrice).toBeNull();
    expect(out.missions[0].assignment.vehicle.purchasePrice).toBeNull();
    expect(out.missions[0].assignment.driver).toEqual({ id: 3 });
  });

  it("conserve les dates et ne touche pas l'entrée", () => {
    const out = redactVehiclePriceDeep({ role: "client" }, mission);
    expect(out.startedAt).toBeInstanceOf(Date);
    expect(out.vehicle.purchaseDate).toBeInstanceOf(Date);
    expect(mission.vehicle.purchasePrice).toBe("15000000.00");
  });

  it("une fiche pneu (purchasePrice sans immatriculation) n'est pas un véhicule", () => {
    expect(redactVehiclePriceDeep({ role: "warehouse" }, [tire])[0].purchasePrice).toBe("80000.00");
  });

  it.each(VEHICLE_PURCHASE_PRICE_READ_ROLES)("%s : valeur rendue telle quelle", (role) => {
    expect(redactVehiclePriceDeep({ role }, mission)).toBe(mission);
  });

  it("sans lecteur : expurgé", () => {
    expect(redactVehiclePriceDeep(undefined, mission).vehicle.purchasePrice).toBeNull();
  });
});
