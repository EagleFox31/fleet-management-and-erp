import { describe, expect, it } from "vitest";
import {
  CEMAC_CORRIDORS,
  LOGISTICS_HUBS,
  findCorridorByDestination,
  interpolateCorridorPosition,
} from "@shared/constants/cemac-corridors";

describe("CEMAC Corridors & Logistics Hubs", () => {
  it("contient les 16 hubs logistiques stratégiques avec des coordonnées valides", () => {
    const hubKeys = Object.keys(LOGISTICS_HUBS);
    expect(hubKeys.length).toBeGreaterThanOrEqual(15);

    expect(LOGISTICS_HUBS.douala).toBeDefined();
    expect(LOGISTICS_HUBS.yaounde).toBeDefined();
    expect(LOGISTICS_HUBS.garoua).toBeDefined();
    expect(LOGISTICS_HUBS.maroua).toBeDefined();
    expect(LOGISTICS_HUBS.ndjamena).toBeDefined();
    expect(LOGISTICS_HUBS.bangui).toBeDefined();

    for (const hub of Object.values(LOGISTICS_HUBS)) {
      expect(hub.coordinates[0]).toBeGreaterThan(1); // Latitude > 1°N
      expect(hub.coordinates[0]).toBeLessThan(15); // Latitude < 15°N
      expect(hub.coordinates[1]).toBeGreaterThan(8); // Longitude > 8°E
      expect(hub.coordinates[1]).toBeLessThan(20); // Longitude < 20°E
    }
  });

  it("définit les 4 grands corridors avec des polylines cohérentes", () => {
    const corridors = Object.values(CEMAC_CORRIDORS);
    expect(corridors).toHaveLength(4);

    for (const corridor of corridors) {
      expect(corridor.polyline.length).toBeGreaterThanOrEqual(5);
      expect(corridor.distanceKm).toBeGreaterThan(200);
      expect(corridor.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("résout le bon corridor selon la destination", () => {
    expect(findCorridorByDestination("Garoua (Bénoué)").id).toBe("corridor-nord");
    expect(findCorridorByDestination("N'Djamena Centre").id).toBe("corridor-nord");
    expect(findCorridorByDestination("Maroua").id).toBe("corridor-nord");
    expect(findCorridorByDestination("Bafoussam Ouest").id).toBe("corridor-ouest");
    expect(findCorridorByDestination("Bangui Port").id).toBe("corridor-est");
    expect(findCorridorByDestination("Kribi Port").id).toBe("corridor-sud");
  });

  it("interpole correctement la position sur la polyline d'un corridor", () => {
    const polyline: [number, number][] = [
      [4.0, 9.0],
      [6.0, 11.0],
      [8.0, 13.0],
    ];

    // À 0% -> premier point
    const pos0 = interpolateCorridorPosition(polyline, 0);
    expect(pos0).toEqual([4.0, 9.0]);

    // À 100% -> dernier point
    const pos100 = interpolateCorridorPosition(polyline, 100);
    expect(pos100).toEqual([8.0, 13.0]);

    // À 50% -> point médian
    const pos50 = interpolateCorridorPosition(polyline, 50);
    expect(pos50).toEqual([6.0, 11.0]);
  });
});
