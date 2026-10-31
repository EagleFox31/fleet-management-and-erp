import { describe, expect, it } from "vitest";
import { driverVehicleOptions, fleetVehicleOptions } from "@/lib/incident-vehicles";

describe("véhicules proposés à la déclaration de panne", () => {
  it("chauffeur : ses véhicules de mission, mission active d'abord, sans doublon", () => {
    const options = driverVehicleOptions({
      missions: [
        { status: "completed", vehicleId: 4, vehicleRegistration: "AB-004" },
        { status: "in_progress", vehicleId: 9, vehicleRegistration: "AB-009" },
        { status: "completed", vehicleId: 9, vehicleRegistration: "AB-009" },
        { status: "assigned", vehicleId: null },
      ],
    });
    expect(options).toEqual([
      { id: 9, label: "AB-009" },
      { id: 4, label: "AB-004" },
    ]);
  });

  it("chauffeur sans mission ou sans fiche : aucun véhicule", () => {
    expect(driverVehicleOptions({ missions: [] })).toEqual([]);
    expect(driverVehicleOptions(undefined)).toEqual([]);
  });

  it("flotte : lit la réponse paginée { vehicles } comme un tableau nu", () => {
    const vehicles = [{ id: 1, registrationNumber: "RCT-001" }, { id: 2 }];
    const expected = [
      { id: 1, label: "RCT-001" },
      { id: 2, label: "Véhicule 2" },
    ];
    expect(fleetVehicleOptions({ vehicles })).toEqual(expected);
    expect(fleetVehicleOptions(vehicles)).toEqual(expected);
  });

  it("flotte : réponse inattendue sans planter", () => {
    expect(fleetVehicleOptions(null)).toEqual([]);
    expect(fleetVehicleOptions({ message: "x" })).toEqual([]);
    expect(fleetVehicleOptions({ vehicles: [{ id: "3" }] })).toEqual([]);
  });
});
