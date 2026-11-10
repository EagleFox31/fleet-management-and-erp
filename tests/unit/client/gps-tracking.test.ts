import { describe, expect, it } from "vitest";
import {
  GPS_BATCH_MAX,
  GPS_BUFFER_MAX,
  appendBounded,
  buildGoogleDirectionsUrl,
  gpsBufferKey,
  isBatchSettled,
  nextBatch,
  parseBuffer,
  removeSent,
  shouldRecord,
  shouldTrack,
  toGpsPoint,
  type GpsPoint,
  type RawFix,
} from "@/lib/gps-tracking";
import { MAP_TILES } from "@/lib/map-tiles";

const T0 = Date.parse("2026-11-10T08:00:00Z");
const fix = (over: Partial<RawFix> = {}): RawFix => ({ lat: 4.05, lng: 9.7, timestamp: T0, ...over });
const point = (n: number): GpsPoint => ({ clientPointId: `id-${n}`, recordedAt: new Date(T0 + n * 1000).toISOString(), lat: 4, lng: 9 });

describe("échantillonnage 60 s / 200 m", () => {
  it("garde le premier relevé", () => {
    expect(shouldRecord(null, fix())).toBe(true);
  });
  it("ignore un relevé proche et récent", () => {
    expect(shouldRecord(fix(), fix({ timestamp: T0 + 59_000, lat: 4.0501 }))).toBe(false);
  });
  it("garde au bout de 60 s même sans déplacement", () => {
    expect(shouldRecord(fix(), fix({ timestamp: T0 + 60_000 }))).toBe(true);
  });
  it("garde après 200 m même avant 60 s (0,0021 degré = 233 m, 0,0017 = 189 m)", () => {
    expect(shouldRecord(fix(), fix({ timestamp: T0 + 5_000, lat: 4.0521 }))).toBe(true);
    expect(shouldRecord(fix(), fix({ timestamp: T0 + 5_000, lat: 4.0517 }))).toBe(false);
  });
});

describe("construction d'un point", () => {
  it("convertit m/s en km/h et écarte les valeurs inconnues ou hors borne", () => {
    const p = toGpsPoint(fix({ speed: 10, heading: 359.9, accuracy: 12 }), () => "u");
    expect(p).toMatchObject({ clientPointId: "u", speedKmh: 36, heading: 359.9, accuracyM: 12, recordedAt: "2026-11-10T08:00:00.000Z" });
    const q = toGpsPoint(fix({ speed: null, heading: 360, accuracy: -1 }), () => "u");
    expect(q.speedKmh).toBeUndefined();
    expect(q.heading).toBeUndefined();
    expect(q.accuracyM).toBeUndefined();
  });
  it("génère un UUID v4 valide, distinct par point, et stable une fois le point créé", () => {
    const a = toGpsPoint(fix());
    const b = toGpsPoint(fix());
    expect(a.clientPointId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.clientPointId).not.toBe(b.clientPointId);
    const stored = parseBuffer(JSON.stringify([a]));
    expect(stored[0].clientPointId).toBe(a.clientPointId);
  });
});

describe("tampon", () => {
  it("envoie par paquets de 50 au plus, les plus anciens d'abord", () => {
    const buffer = Array.from({ length: 120 }, (_, i) => point(i));
    const batch = nextBatch(buffer);
    expect(batch).toHaveLength(GPS_BATCH_MAX);
    expect(batch[0].clientPointId).toBe("id-0");
    expect(removeSent(buffer, batch)).toHaveLength(70);
  });
  it("borne sa taille en jetant les plus anciens", () => {
    let buffer: GpsPoint[] = [];
    for (let i = 0; i < GPS_BUFFER_MAX + 5; i++) buffer = appendBounded(buffer, point(i));
    expect(buffer).toHaveLength(GPS_BUFFER_MAX);
    expect(buffer[0].clientPointId).toBe("id-5");
  });
  it("relit un tampon abîmé sans planter", () => {
    expect(parseBuffer("pas du json")).toEqual([]);
    expect(parseBuffer(JSON.stringify([{ a: 1 }, point(1)]))).toHaveLength(1);
    expect(parseBuffer(null)).toEqual([]);
  });
  it("sa clé est distincte de la base hors ligne V5b", () => {
    expect(gpsBufferKey(7, 42)).toBe("fleetos-gps-buffer-u7-m42");
    expect(gpsBufferKey(7, 42)).not.toContain("fleetos-offline-u");
  });
  it("accepted:0 avec doublons est un succès, un paquet non décidé n'en est pas un", () => {
    expect(isBatchSettled({ accepted: 0, duplicates: 3, rejected: 0 }, 3)).toBe(true);
    expect(isBatchSettled({ accepted: 1, duplicates: 1, rejected: 1 }, 3)).toBe(true);
    expect(isBatchSettled({ accepted: 1, duplicates: 0, rejected: 0 }, 3)).toBe(false);
    expect(isBatchSettled(null, 3)).toBe(false);
  });
});

describe("lien Google Maps", () => {
  it("utilise les coordonnées quand elles existent", () => {
    const url = new URL(buildGoogleDirectionsUrl({ lat: 4.05, lng: 9.7 }, { lat: 3.87, lng: 11.52 })!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("4.05,9.7");
    expect(url.searchParams.get("destination")).toBe("3.87,11.52");
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });
  it("replie sur l'adresse texte, encodée", () => {
    const raw = buildGoogleDirectionsUrl({ address: "Port de Douala" }, { address: "Rue & Avenue, Yaoundé" })!;
    expect(new URL(raw).searchParams.get("destination")).toBe("Rue & Avenue, Yaoundé");
    expect(raw).not.toContain("Rue & Avenue");
  });
  it("sans destination, pas de lien ; sans origine, pas de paramètre origin", () => {
    expect(buildGoogleDirectionsUrl(null, {})).toBeNull();
    expect(new URL(buildGoogleDirectionsUrl(null, { address: "Kribi" })!).searchParams.has("origin")).toBe(false);
  });
});

describe("fenêtre de suivi et drapeau", () => {
  it("suit seulement in_progress et seulement si le drapeau gps est allumé", () => {
    expect(shouldTrack("in_progress", true)).toBe(true);
    expect(shouldTrack("in_progress", false)).toBe(false);
    for (const s of ["assigned", "delivered", "completed", "cancelled", undefined]) expect(shouldTrack(s, true)).toBe(false);
  });
});

describe("config des tuiles", () => {
  it("replie sur OpenStreetMap avec son attribution quand l'environnement ne règle rien", () => {
    expect(MAP_TILES.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(MAP_TILES.attribution).toContain("OpenStreetMap");
    expect(MAP_TILES.maxZoom).toBe(19);
  });
});
