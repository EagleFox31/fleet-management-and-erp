/**
 * Affichage du suivi GPS V1 : logique pure (fraîcheur, hub le plus proche, points A/B, trace).
 * Aucune dépendance à React ni à Leaflet : testable sans navigateur.
 */
import { LOGISTICS_HUBS } from "@shared/constants/cemac-corridors";
import { GPS_TRACK_ROLES, GPS_VIEW_ROLES, MISSION_GEO_WRITE_ROLES } from "@shared/constants/roles";
import type { MissionGeoPointInput, MissionTrackPoint } from "@shared/contracts/gps";

/** Au-delà de ce délai la position est signalée en orange, puis en gris (cadrage §3.3). */
export const POSITION_STALE_SECONDS = 15 * 60;
export const POSITION_OLD_SECONDS = 60 * 60;

export type PositionFreshness = "fresh" | "stale" | "old";

export function positionFreshness(ageSeconds: number): PositionFreshness {
  if (ageSeconds > POSITION_OLD_SECONDS) return "old";
  if (ageSeconds > POSITION_STALE_SECONDS) return "stale";
  return "fresh";
}

/** « il y a 5 min » : l'âge de la position, jamais une heure absolue qu'on lirait comme actuelle. */
export function formatPositionAge(ageSeconds: number): string {
  const seconds = Math.max(0, Math.round(ageSeconds));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/** Âge en secondes d'un horodatage ISO, à l'instant `now` (jamais négatif). */
export function ageSecondsOf(recordedAt: string, now: number = Date.now()): number {
  const t = Date.parse(recordedAt);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((now - t) / 1000));
}

export type HubOption = { code: string; name: string };

/** Hubs proposés à la saisie : clés minuscules du référentiel, triés par nom. */
export const HUB_OPTIONS: readonly HubOption[] = Object.entries(LOGISTICS_HUBS)
  .map(([code, hub]) => ({ code, name: hub.name }))
  .sort((a, b) => a.name.localeCompare(b.name, "fr"));

export function hubName(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(LOGISTICS_HUBS, code) ? LOGISTICS_HUBS[code].name : null;
}

export function hubCoordinates(code: string | null | undefined): [number, number] | null {
  if (!code || !Object.hasOwn(LOGISTICS_HUBS, code)) return null;
  const [lat, lng] = LOGISTICS_HUBS[code].coordinates;
  return [lat, lng];
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hub le plus proche d'une position, pour la colonne « Dernière position » (ville + distance). */
export function nearestHub(lat: number, lng: number): { code: string; name: string; distanceKm: number } {
  let best = { code: "", name: "", distanceKm: Number.POSITIVE_INFINITY };
  for (const [code, hub] of Object.entries(LOGISTICS_HUBS)) {
    const distanceKm = haversineKm({ lat, lng }, { lat: hub.coordinates[0], lng: hub.coordinates[1] });
    if (distanceKm < best.distanceKm) best = { code, name: hub.name, distanceKm };
  }
  return { ...best, distanceKm: Math.round(best.distanceKm) };
}

/** Texte « à 12 km de Douala (Port & Base) », ou « à Douala... » sous 3 km. */
export function describeNearestHub(lat: number, lng: number): string {
  const hub = nearestHub(lat, lng);
  return hub.distanceKm < 3 ? `à ${hub.name}` : `à ${hub.distanceKm} km de ${hub.name}`;
}

/** Dernière position des véhicules : `GPS_VIEW_ROLES`. */
export function canViewPositions(role: string | undefined | null): boolean {
  return !!role && (GPS_VIEW_ROLES as readonly string[]).includes(role);
}

/** Le chef d'atelier lit la dernière position mais pas la trace (`GPS_TRACK_ROLES`). */
export function canViewTrack(role: string | undefined | null): boolean {
  return !!role && (GPS_TRACK_ROLES as readonly string[]).includes(role);
}

export function canEditMissionGeo(role: string | undefined | null): boolean {
  return !!role && (MISSION_GEO_WRITE_ROLES as readonly string[]).includes(role);
}

/** Une mission terminée ou annulée n'accepte plus de point (409 côté serveur). */
export function missionGeoEditable(status: string | null | undefined): boolean {
  return status !== "completed" && status !== "cancelled";
}

export type GeoSelection =
  | { kind: "none" }
  | { kind: "hub"; hubCode: string }
  | { kind: "map"; lat: number; lng: number };

export const NO_GEO: GeoSelection = { kind: "none" };

/** Point stocké (réponse du serveur) vers l'état de saisie. */
export function geoSelectionOf(point: { lat: number | null; lng: number | null; hubCode: string | null } | null | undefined): GeoSelection {
  if (!point) return NO_GEO;
  if (point.hubCode && Object.hasOwn(LOGISTICS_HUBS, point.hubCode)) return { kind: "hub", hubCode: point.hubCode };
  if (typeof point.lat === "number" && typeof point.lng === "number") return { kind: "map", lat: point.lat, lng: point.lng };
  return NO_GEO;
}

/** État de saisie vers le corps de `PATCH /geo` (`null` efface le point). */
export function geoInputOf(selection: GeoSelection): MissionGeoPointInput {
  if (selection.kind === "hub") return { hubCode: selection.hubCode };
  if (selection.kind === "map") return { lat: selection.lat, lng: selection.lng };
  return null;
}

/**
 * Champs à joindre à `POST /api/missions` pour un point (`pickup` ou `delivery`). Sans point : rien,
 * le serveur laisse les colonnes vides.
 */
export function geoCreateFields(which: "pickup" | "delivery", selection: GeoSelection): Record<string, unknown> {
  if (selection.kind === "hub") return { [`${which}HubCode`]: selection.hubCode };
  if (selection.kind === "map") return { [`${which}Lat`]: selection.lat, [`${which}Lng`]: selection.lng };
  return {};
}

export function sameGeoSelection(a: GeoSelection, b: GeoSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "hub" && b.kind === "hub") return a.hubCode === b.hubCode;
  if (a.kind === "map" && b.kind === "map") return a.lat === b.lat && a.lng === b.lng;
  return true;
}

/** Points fiables regroupés par véhicule (ordre d'apparition), un tracé par groupe ; sans vehicleId, un seul groupe. */
export function groupByVehicle(points: readonly MissionTrackPoint[]): MissionTrackPoint[][] {
  const groups = new Map<number | null, MissionTrackPoint[]>();
  for (const point of points) {
    const key = point.vehicleId ?? null;
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }
  return Array.from(groups.values());
}

/** Trace en deux jeux : points fiables (trait plein) et points suspects (marqués à part). */
export function splitTrack(points: readonly MissionTrackPoint[]): {
  reliable: MissionTrackPoint[];
  suspect: MissionTrackPoint[];
} {
  const reliable: MissionTrackPoint[] = [];
  const suspect: MissionTrackPoint[] = [];
  for (const point of points) (point.suspect ? suspect : reliable).push(point);
  return { reliable, suspect };
}
