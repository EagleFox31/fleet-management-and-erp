import { describe, expect, it } from "vitest";
import {
  ageSecondsOf,
  canViewPositions,
  canViewTrack,
  canEditMissionGeo,
  formatPositionAge,
  groupByVehicle,
  positionFreshness,
  splitTrack,
} from "@/lib/gps-display";
import type { MissionTrackPoint } from "@shared/contracts/gps";

const pt = (id: number, over: Partial<MissionTrackPoint> = {}): MissionTrackPoint => ({
  id,
  recordedAt: "2026-11-10T10:00:00Z",
  lat: 4,
  lng: 9,
  suspect: false,
  ...over,
});

describe("gps-display", () => {
  it("fraîcheur : seuils 15 et 60 minutes", () => {
    expect(positionFreshness(14 * 60)).toBe("fresh");
    expect(positionFreshness(30 * 60)).toBe("stale");
    expect(positionFreshness(90 * 60)).toBe("old");
  });

  it("âge jamais négatif et libellé lisible", () => {
    const now = Date.parse("2026-11-10T10:05:00Z");
    expect(ageSecondsOf("2026-11-10T10:00:00Z", now)).toBe(300);
    expect(ageSecondsOf("2026-11-10T10:10:00Z", now)).toBe(0);
    expect(formatPositionAge(300)).toMatch(/5 min/);
  });

  it("les points suspects sont séparés de la trace", () => {
    const { reliable, suspect } = splitTrack([pt(1), pt(2, { suspect: true }), pt(3)]);
    expect(reliable.map((p) => p.id)).toEqual([1, 3]);
    expect(suspect.map((p) => p.id)).toEqual([2]);
  });

  it("une polyligne par véhicule", () => {
    const groups = groupByVehicle([pt(1, { vehicleId: 7 }), pt(2, { vehicleId: 8 }), pt(3, { vehicleId: 7 })]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([[1, 3], [2]]);
    expect(groupByVehicle([pt(1), pt(2)])).toHaveLength(1);
  });

  it("rôles : le chef d'atelier voit la position mais pas la trace", () => {
    expect(canViewPositions("workshop_manager")).toBe(true);
    expect(canViewTrack("workshop_manager")).toBe(false);
    expect(canViewTrack("logistics")).toBe(true);
    expect(canViewPositions("technician")).toBe(false);
    expect(canEditMissionGeo("logistics")).toBe(true);
    expect(canEditMissionGeo("management")).toBe(false);
  });
});

describe("hygiène : tuiles", () => {
  it("aucune URL de tuiles en dur hors de map-tiles.ts", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
      });
    const offenders = walk(join(process.cwd(), "client", "src")).filter(
      (f) => !f.split("\\").join("/").endsWith("lib/map-tiles.ts") && /basemaps\.cartocdn|tile\.openstreetmap/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
