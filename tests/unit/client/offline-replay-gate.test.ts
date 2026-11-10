import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/queryClient";
import {
  REPLAY_GATE_MAX_WAIT_MS,
  beginReplayGate,
  releaseReplayGate,
  requestResyncAfterDrain,
  resetReplayGateForTests,
  setOfflineResyncHandler,
  whenReplaySettled,
} from "@/lib/offline-replay-gate";
import { getOfflineAction, registerOfflineAction, requiredFlagsOf } from "@/lib/offline-action-registry";

describe("barrière de rejeu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReplayGateForTests();
  });
  afterEach(() => {
    resetReplayGateForTests();
    vi.useRealTimers();
  });

  it("ouverte par défaut : le resync n'attend rien", async () => {
    await expect(whenReplaySettled()).resolves.toBeUndefined();
  });

  it("fermée : le resync attend la levée, puis part", async () => {
    beginReplayGate();
    let settled = false;
    void whenReplaySettled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    releaseReplayGate();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it("personne ne la lève : le délai maximal rend la main", async () => {
    beginReplayGate();
    let settled = false;
    void whenReplaySettled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(REPLAY_GATE_MAX_WAIT_MS + 1);
    expect(settled).toBe(true);
  });

  it("un seul resync demandé après vidange, sans gestionnaire rien ne se passe", () => {
    expect(() => requestResyncAfterDrain()).not.toThrow();
    const handler = vi.fn();
    setOfflineResyncHandler(handler);
    requestResyncAfterDrain();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("registre des types d'écriture", () => {
  it("exige toujours offline-writes en plus des drapeaux du type", () => {
    const fuel = getOfflineAction("fuel_entry")!;
    expect(requiredFlagsOf(fuel)).toEqual(["offline-writes", "driver-offline"]);
    registerOfflineAction({ type: "t_test", label: "T", method: "PUT", routeExample: "/api/vehicles/1/mileage" });
    expect(requiredFlagsOf(getOfflineAction("t_test")!)).toEqual(["offline-writes"]);
  });
});

describe("apiRequest accepte des en-têtes (signature positionnelle)", () => {
  it("transmet Idempotency-Key sans perdre le Content-Type JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await apiRequest("POST", "/api/x", { a: 1 }, { headers: { "Idempotency-Key": "k-1" } });
      await apiRequest("/api/x", "POST", { a: 1 }, { headers: { "Idempotency-Key": "k-2" } });
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      for (const [index, key] of ["k-1", "k-2"].entries()) {
        const headers = new Headers(calls[index][1].headers);
        expect(headers.get("Idempotency-Key")).toBe(key);
        expect(headers.get("Content-Type")).toBe("application/json");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
