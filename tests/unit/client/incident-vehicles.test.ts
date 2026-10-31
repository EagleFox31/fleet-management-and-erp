import { describe, expect, it } from "vitest";
import { driverVehicleOptions, fleetVehicleOptions } from "@/lib/incident-vehicles";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";

describe("véhicules proposés à la déclaration de panne", () => {
  it("chauffeur : véhicules des affectations actives seulement, mission en cours d'abord, sans doublon", () => {
    const options = driverVehicleOptions({
      missions: [
        { status: "assigned", assignmentStatus: "pending", vehicleId: 4, vehicleRegistration: "AB-004" },
        { status: "in_progress", assignmentStatus: "in_progress", vehicleId: 9, vehicleRegistration: "AB-009" },
        { status: "completed", assignmentStatus: "completed", vehicleId: 9, vehicleRegistration: "AB-009" },
        { status: "assigned", assignmentStatus: "accepted", vehicleId: null },
      ],
    });
    expect(options).toEqual([
      { id: 9, label: "AB-009" },
      { id: 4, label: "AB-004" },
    ]);
  });

  it("chauffeur : une affectation terminée, annulée ou sans statut ne propose pas son véhicule (le serveur la refuserait)", () => {
    for (const assignmentStatus of ["completed", "cancelled", "rejected", null, undefined]) {
      expect(driverVehicleOptions({ missions: [{ status: "completed", assignmentStatus, vehicleId: 4 }] })).toEqual([]);
    }
  });

  it("chauffeur : chaque statut actif partagé avec le serveur propose le véhicule", () => {
    for (const assignmentStatus of ACTIVE_ASSIGNMENT_STATUSES) {
      expect(driverVehicleOptions({ missions: [{ assignmentStatus, vehicleId: 7 }] })).toEqual([{ id: 7, label: "Véhicule 7" }]);
    }
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
