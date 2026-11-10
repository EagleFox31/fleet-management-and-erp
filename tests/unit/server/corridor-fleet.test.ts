import { describe, expect, it } from "vitest";
import { buildCorridorVehicle, deriveTransitStatus } from "../../../server/services/corridor-fleet";

const vehicle = (id: number, status = "operational") => ({
  id,
  registrationNumber: `TEST-${id}`,
  brand: "B",
  model: "M",
  status,
});

describe("carte corridors : aucune donnée inventée (GPS-FE-4)", () => {
  it("aucun véhicule sans mission n'est « en transit », quel que soit son rang", () => {
    for (let id = 1; id <= 30; id += 1) {
      const row = buildCorridorVehicle(vehicle(id), undefined);
      expect(row.transitStatus).toBe("stopped");
    }
  });

  it("aucune coordonnée ni progression sans source de position réelle", () => {
    const withMission = buildCorridorVehicle(vehicle(1), {
      missionId: 9,
      missionStatus: "in_progress",
      assignmentStatus: "in_progress",
      deliveryAddress: "Garoua",
    });
    for (const row of [buildCorridorVehicle(vehicle(2), undefined), withMission]) {
      expect(row.positionSource).toBe("none");
      expect(row).not.toHaveProperty("currentLat");
      expect(row).not.toHaveProperty("currentLng");
      expect(row.progressPercent).toBeUndefined();
      expect("speedKmh" in row).toBe(false);
    }
  });

  it("« en transit » seulement pour une mission in_progress", () => {
    expect(deriveTransitStatus("operational", "in_progress", "in_progress")).toBe("in_transit");
    expect(deriveTransitStatus("operational", "in_progress", "accepted")).toBe("in_transit");
    expect(deriveTransitStatus("operational", "in_progress", "pending")).toBe("loading");
    expect(deriveTransitStatus("operational", "in_progress")).toBe("loading");
    expect(deriveTransitStatus("operational", "assigned")).toBe("loading");
    expect(deriveTransitStatus("operational", "planned")).toBe("loading");
    expect(deriveTransitStatus("operational", "delivered")).toBe("stopped");
    expect(deriveTransitStatus("operational", undefined)).toBe("stopped");
    expect(deriveTransitStatus("maintenance", "in_progress", "in_progress")).toBe("alert");
  });

  it("origine, destination et consommation ne sont pas inventées", () => {
    const idle = buildCorridorVehicle(vehicle(3), undefined);
    expect(idle.origin).toBeUndefined();
    expect(idle.destination).toBeUndefined();
    expect(idle.corridorId).toBeUndefined();
    expect(idle.fuelConsumptionAvg).toBeUndefined();

    const noFuel = buildCorridorVehicle(vehicle(4), {
      missionId: 1,
      missionStatus: "in_progress",
      actualDistance: 800,
    });
    expect(noFuel.fuelConsumptionAvg).toBeUndefined();

    const measured = buildCorridorVehicle(vehicle(5), {
      missionId: 1,
      missionStatus: "in_progress",
      actualDistance: "500",
      actualFuelQuantity: "170",
    });
    expect(measured.fuelConsumptionAvg).toBe(34);
  });

  it("une position réelle fournie est reprise avec sa source et son horodatage", () => {
    const at = new Date("2026-11-10T08:00:00Z");
    const row = buildCorridorVehicle(vehicle(6), undefined, { lat: 4.05, lng: 9.7, source: "phone", recordedAt: at });
    expect(row).toMatchObject({ currentLat: 4.05, currentLng: 9.7, positionSource: "phone", positionAt: at.toISOString() });
  });
});
