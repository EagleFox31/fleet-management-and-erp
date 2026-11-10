import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, invalidateQueries } = vi.hoisted(() => ({ apiRequest: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest, queryClient: { invalidateQueries } }));

import { ApiError } from "@/lib/api-error";
import { replayOrphanBuffers, sendBuffered } from "@/hooks/use-gps-tracking";
import { purgeBrowserUserState } from "@/lib/form-draft-storage";
import {
  GPS_ACCURACY_MAX_M,
  GPS_BUFFER_MAX_AGE_MS,
  gpsBufferKey,
  gpsPurgeEpoch,
  isBufferExpired,
  missionIdOfBufferKey,
  shouldDropBatch,
  shouldRefreshDisplay,
  toGpsPoint,
  userBufferKeys,
  type GpsPoint,
} from "@/lib/gps-tracking";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const point = (n: number, at = NOW - n * 1000): GpsPoint => ({ clientPointId: `id-${n}`, recordedAt: new Date(at).toISOString(), lat: 4, lng: 9 });

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const ok = (n: number) => ({ json: async () => ({ accepted: n, duplicates: 0, rejected: 0 }) });
const refused = (status: number) => new ApiError(status, "refus", { message: "Mission terminée.", code: "x" });

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  apiRequest.mockReset();
  invalidateQueries.mockReset();
  storage = fakeStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.setSystemTime(NOW);
});

describe("purge des tampons GPS à la déconnexion (cloison #56)", () => {
  it("efface les tampons de tous les comptes, laisse le reste", () => {
    const s = fakeStorage({
      [gpsBufferKey(7, 11)]: "[]",
      [gpsBufferKey(8, 12)]: "[]",
      "fleetos-offline-db-registry": "[]",
      theme: "dark",
    });
    purgeBrowserUserState(s);
    expect(Array.from(s.map.keys()).sort()).toEqual(["fleetos-offline-db-registry", "theme"]);
  });

  it("une écriture en cours pendant la purge ne recrée pas la clé", async () => {
    const key = gpsBufferKey(7, 11);
    storage.setItem(key, JSON.stringify([point(1)]));
    apiRequest.mockImplementation(async () => {
      purgeBrowserUserState(storage);
      return ok(1);
    });
    const before = gpsPurgeEpoch();
    await replayOrphanBuffers(7);
    expect(gpsPurgeEpoch()).toBeGreaterThan(before);
    expect(storage.map.has(key)).toBe(false);
  });
});

describe("tri des refus du serveur", () => {
  it.each([400, 403, 404, 409])("un %i retire le paquet et affiche le message", async (status) => {
    apiRequest.mockRejectedValue(refused(status));
    const result = await sendBuffered(11, [point(1), point(2)]);
    expect(result.remaining).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it.each([401, 408, 429])("un %i garde le paquet, sans relance en boucle", async (status) => {
    apiRequest.mockRejectedValue(refused(status));
    const buffer = [point(1), point(2)];
    const result = await sendBuffered(11, buffer);
    expect(result.remaining).toEqual(buffer);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(result.sentAny).toBe(false);
  });

  it("une coupure réseau ou un 500 garde le paquet", async () => {
    apiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await sendBuffered(11, [point(1)])).remaining).toHaveLength(1);
    apiRequest.mockRejectedValueOnce(refused(500));
    const result = await sendBuffered(11, [point(1)]);
    expect(result.remaining).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("envoie plus de 50 points en plusieurs paquets", async () => {
    apiRequest.mockImplementation(async (_m: string, _u: string, body: { points: GpsPoint[] }) => ok(body.points.length));
    const buffer = Array.from({ length: 120 }, (_, i) => point(i));
    const result = await sendBuffered(11, buffer);
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(result.remaining).toEqual([]);
    expect(result.sentAny).toBe(true);
  });

  it("shouldDropBatch", () => {
    expect([400, 401, 403, 408, 429, 500].map(shouldDropBatch)).toEqual([true, false, true, false, false, false]);
  });
});

describe("rejeu des tampons orphelins", () => {
  it("rejoue chaque mission de l'utilisateur, retire la clé réglée, ignore la mission suivie et les autres comptes", async () => {
    const seen: string[] = [];
    apiRequest.mockImplementation(async (_m: string, url: string, body: { points: GpsPoint[] }) => {
      seen.push(url);
      return ok(body.points.length);
    });
    storage.setItem(gpsBufferKey(7, 11), JSON.stringify([point(1)]));
    storage.setItem(gpsBufferKey(7, 12), JSON.stringify([point(2)]));
    storage.setItem(gpsBufferKey(7, 13), JSON.stringify([point(3)]));
    storage.setItem(gpsBufferKey(8, 14), JSON.stringify([point(4)]));
    await replayOrphanBuffers(7, 13);
    expect(seen.sort()).toEqual(["/api/driver/missions/11/positions", "/api/driver/missions/12/positions"]);
    expect(Array.from(storage.map.keys()).sort()).toEqual([gpsBufferKey(7, 13), gpsBufferKey(8, 14)].sort());
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("garde la clé si l'envoi échoue (réseau), pour le prochain retour en ligne", async () => {
    apiRequest.mockRejectedValue(new TypeError("Failed to fetch"));
    storage.setItem(gpsBufferKey(7, 11), JSON.stringify([point(1)]));
    await replayOrphanBuffers(7);
    expect(storage.map.has(gpsBufferKey(7, 11))).toBe(true);
  });

  it("supprime sans l'envoyer un tampon de plus de 7 jours", async () => {
    storage.setItem(gpsBufferKey(7, 11), JSON.stringify([point(1, NOW - GPS_BUFFER_MAX_AGE_MS - 60_000)]));
    await replayOrphanBuffers(7);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(storage.map.has(gpsBufferKey(7, 11))).toBe(false);
  });
});

describe("clés et bornes", () => {
  it("missionIdOfBufferKey / userBufferKeys isolent l'utilisateur", () => {
    expect(missionIdOfBufferKey(gpsBufferKey(7, 11), 7)).toBe(11);
    expect(missionIdOfBufferKey(gpsBufferKey(70, 11), 7)).toBeNull();
    expect(missionIdOfBufferKey("fleetos-gps-buffer-u7-m0", 7)).toBeNull();
    const s = fakeStorage({ [gpsBufferKey(7, 1)]: "[]", [gpsBufferKey(7, 2)]: "[]", [gpsBufferKey(9, 3)]: "[]" });
    expect(userBufferKeys(s, 7).map((e) => e.missionId).sort()).toEqual([1, 2]);
  });

  it("isBufferExpired", () => {
    expect(isBufferExpired([], NOW)).toBe(true);
    expect(isBufferExpired([point(1)], NOW)).toBe(false);
    expect(isBufferExpired([point(1, NOW - GPS_BUFFER_MAX_AGE_MS - 1)], NOW)).toBe(true);
  });

  it("écrête la précision à la borne du serveur", () => {
    expect(toGpsPoint({ lat: 4, lng: 9, timestamp: NOW, accuracy: 5_000_000 }).accuracyM).toBe(GPS_ACCURACY_MAX_M);
    expect(toGpsPoint({ lat: 4, lng: 9, timestamp: NOW, accuracy: 12 }).accuracyM).toBe(12);
  });

  it("limite l'affichage de la position (10 s ou 20 m)", () => {
    const a = { lat: 4.05, lng: 9.7, timestamp: NOW };
    expect(shouldRefreshDisplay(null, a)).toBe(true);
    expect(shouldRefreshDisplay(a, { ...a, timestamp: NOW + 5_000, lat: 4.05005 })).toBe(false);
    expect(shouldRefreshDisplay(a, { ...a, timestamp: NOW + 10_000 })).toBe(true);
    expect(shouldRefreshDisplay(a, { ...a, timestamp: NOW + 2_000, lat: 4.0503 })).toBe(true);
  });
});
