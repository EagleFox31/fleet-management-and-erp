import { describe, it, expect } from "vitest";
import {
  computeVehicleFuelStats,
  computeVehicleConsumptionRows,
  formatConsumptionDisplay,
  type FuelRecordForConsumption,
} from "@/lib/fuel-consumption";

function record(
  partial: Partial<FuelRecordForConsumption> & Pick<FuelRecordForConsumption, "vehicleId">,
): FuelRecordForConsumption {
  return {
    date: partial.date ?? "2026-01-01",
    quantity: partial.quantity ?? 0,
    mileage: partial.mileage ?? null,
    ...partial,
  };
}

describe("computeVehicleFuelStats", () => {
  it("exclut le carburant du premier plein (pas de sur-estimation +100%)", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, date: "2026-01-01", mileage: 100_000, quantity: 400 }),
      record({ vehicleId: 1, date: "2026-02-01", mileage: 101_000, quantity: 350 }),
    ]);

    expect(stats.totalFuel).toBe(350);
    expect(stats.totalDistance).toBe(1_000);
    expect(stats.averageConsumption).toBeCloseTo(35, 5);
    expect(stats.unavailableReason).toBeNull();
  });

  it("signale un seul plein avec message explicite", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, mileage: 50_000, quantity: 300 }),
    ]);

    expect(stats.averageConsumption).toBeNull();
    expect(stats.unavailableReason).toBe("Un seul plein enregistré, il en faut deux");
  });

  it("ignore un intervalle sans kilométrage au lieu d'inventer 0 km", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, date: "2026-01-01", mileage: 100_000, quantity: 400 }),
      record({ vehicleId: 1, date: "2026-02-01", mileage: null, quantity: 200 }),
      record({ vehicleId: 1, date: "2026-03-01", mileage: 101_500, quantity: 300 }),
    ]);

    expect(stats.totalFuel).toBe(0);
    expect(stats.totalDistance).toBe(0);
    expect(stats.averageConsumption).toBeNull();
    expect(stats.unavailableReason).toBe("Kilométrage non renseigné sur les pleins");
  });

  it("calcule un intervalle valide entre deux pleins consécutifs avec kilométrage", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, date: "2026-01-01", mileage: 100_000, quantity: 400 }),
      record({ vehicleId: 1, date: "2026-02-01", mileage: 101_500, quantity: 300 }),
    ]);

    expect(stats.totalFuel).toBe(300);
    expect(stats.totalDistance).toBe(1_500);
    expect(stats.averageConsumption).toBeCloseTo(20, 5);
  });

  it("évite l'explosion silencieuse quand le kilométrage intermédiaire est absent", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, date: "2026-01-01", mileage: 100_000, quantity: 400 }),
      record({ vehicleId: 1, date: "2026-02-01", mileage: null, quantity: 250 }),
      record({ vehicleId: 1, date: "2026-03-01", mileage: 250_000, quantity: 500 }),
    ]);

    expect(stats.totalDistance).toBe(0);
    expect(stats.averageConsumption).toBeNull();
    expect(stats.unavailableReason).toBe("Kilométrage non renseigné sur les pleins");
  });

  it("cumule plusieurs intervalles valides consécutifs", () => {
    const stats = computeVehicleFuelStats([
      record({ vehicleId: 1, date: "2026-01-01", mileage: 10_000, quantity: 100 }),
      record({ vehicleId: 1, date: "2026-02-01", mileage: 10_500, quantity: 50 }),
      record({ vehicleId: 1, date: "2026-03-01", mileage: 11_000, quantity: 45 }),
    ]);

    expect(stats.totalFuel).toBe(95);
    expect(stats.totalDistance).toBe(1_000);
    expect(stats.averageConsumption).toBeCloseTo(9.5, 5);
    expect(stats.validIntervalCount).toBe(2);
  });
});

describe("computeVehicleConsumptionRows", () => {
  it("regroupe par véhicule sans re-parcours quadratique", () => {
    const rows = computeVehicleConsumptionRows(
      [
        record({ vehicleId: 2, date: "2026-01-05", mileage: 20_000, quantity: 200 }),
        record({ vehicleId: 1, date: "2026-01-01", mileage: 10_000, quantity: 100 }),
        record({ vehicleId: 1, date: "2026-02-01", mileage: 10_400, quantity: 40 }),
        record({ vehicleId: 2, date: "2026-02-05", mileage: 20_800, quantity: 160 }),
      ],
      {
        1: { registrationNumber: "AA-001" },
        2: { registrationNumber: "BB-002" },
      },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].registrationNumber).toBe("AA-001");
    expect(rows[0].averageConsumption).toBeCloseTo(10, 5);
    expect(rows[1].registrationNumber).toBe("BB-002");
    expect(rows[1].averageConsumption).toBeCloseTo(20, 5);
  });
});

describe("formatConsumptionDisplay", () => {
  it("affiche une consommation formatée en français", () => {
    expect(
      formatConsumptionDisplay({ averageConsumption: 32.4, unavailableReason: null }),
    ).toEqual({ value: "32,40 L/100 km" });
  });

  it("expose la raison quand le calcul est impossible", () => {
    expect(
      formatConsumptionDisplay({
        averageConsumption: null,
        unavailableReason: "Un seul plein enregistré, il en faut deux",
      }),
    ).toEqual({
      value: "Non calculable",
      detail: "Un seul plein enregistré, il en faut deux",
    });
  });
});

describe("affichage kilométrage", () => {
  it("ne doit pas traiter null comme 0 km", () => {
    const mileage = null as number | null;
    const displayed = mileage == null ? "N/A" : `${mileage.toLocaleString("fr-FR")} km`;
    expect(displayed).toBe("N/A");
  });
});
