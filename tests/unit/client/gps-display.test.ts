import { describe, expect, it } from "vitest";
import {
  adoptStoredGeo,
  ageSecondsOf,
  canViewPositions,
  canViewTrack,
  canEditMissionGeo,
  formatPositionAge,
  geoEditorReady,
  geoInputOf,
  geoSelectionOf,
  groupByVehicle,
  NO_GEO,
  positionFreshness,
  sameGeoPair,
  type GeoPair,
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

describe("hydratation des points A/B", () => {
  const hubs: GeoPair = { pickup: { kind: "hub", hubCode: "douala" }, delivery: { kind: "hub", hubCode: "yaounde" } };
  const empty: GeoPair = { pickup: NO_GEO, delivery: NO_GEO };

  it("un point stocké devient la saisie de départ (le formulaire démarre sur les hubs, pas sur « aucun »)", () => {
    const stored: GeoPair = {
      pickup: geoSelectionOf({ lat: null, lng: null, hubCode: "douala" }),
      delivery: geoSelectionOf({ lat: 3.87, lng: 11.52, hubCode: null }),
    };
    expect(stored.pickup).toEqual({ kind: "hub", hubCode: "douala" });
    expect(stored.delivery).toEqual({ kind: "map", lat: 3.87, lng: 11.52 });
    expect(geoInputOf(stored.pickup)).toEqual({ hubCode: "douala" });
  });

  it("saisie égale à l'ancienne valeur stockée : la nouvelle valeur serveur est adoptée", () => {
    expect(adoptStoredGeo(empty, empty, hubs)).toEqual(hubs);
    expect(adoptStoredGeo(hubs, hubs, empty)).toEqual(empty);
  });

  it("saisie modifiée : la valeur serveur ne l'écrase pas", () => {
    const edited: GeoPair = { ...hubs, pickup: { kind: "map", lat: 4.05, lng: 9.7 } };
    expect(adoptStoredGeo(edited, hubs, empty)).toBe(edited);
  });

  it("geoEditorReady : jamais avant la trace, jamais sans droit d'écriture ni mission figée", () => {
    const track = { status: "in_progress" };
    expect(geoEditorReady(undefined, "logistics", "in_progress")).toBe(false);
    expect(geoEditorReady(null, "admin")).toBe(false);
    expect(geoEditorReady(track, "logistics", "in_progress")).toBe(true);
    expect(geoEditorReady(track, "workshop_manager", "in_progress")).toBe(false);
    expect(geoEditorReady(track, "logistics", "completed")).toBe(false);
  });

  it("l'état de départ égal au stocké n'est pas modifié (bouton Enregistrer inactif)", () => {
    expect(sameGeoPair(hubs, { ...hubs })).toBe(true);
    expect(sameGeoPair(hubs, empty)).toBe(false);
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
      (f) => !f.split("\\").join("/").endsWith("lib/map-tiles.ts") && /\{z\}\/\{x\}\/\{y\}/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
