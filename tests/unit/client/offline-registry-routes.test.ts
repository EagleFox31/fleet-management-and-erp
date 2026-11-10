import { describe, expect, it } from "vitest";
import { getOfflineAction, listOfflineActions } from "@/lib/offline-action-registry";
import { isAutoReplayable } from "@shared/idempotency-routes";

const KEY = "0b1d6c1e-6a39-4a3a-9d55-2f9a3a0c0001";

describe("registre des écritures hors ligne et routes protégées (V5b-2b)", () => {
  it("le registre n'est pas vide", () => {
    expect(listOfflineActions().length).toBeGreaterThan(0);
  });

  // Une clé d'idempotence n'a de valeur que sur une route qui la lit : rejouer une route non protégée
  // après une réponse perdue crée un doublon. Ce test échoue dès qu'un type s'enregistre sans route protégée.
  it.each(listOfflineActions().map((d) => [d.type, d] as const))(
    "le type %s correspond à une route protégée (méthode et chemin)",
    (_type, definition) => {
      expect(
        isAutoReplayable({
          method: definition.method,
          endpoint: definition.routeExample,
          idempotencyKey: KEY,
          payload: { requestKey: KEY },
        }),
      ).toBe(true);
    },
  );

  it("un plein dont requestKey diffère de la clé de l'envoi n'est pas rejouable", () => {
    expect(
      isAutoReplayable({ method: "POST", endpoint: "/api/missions/4/fuel-records", idempotencyKey: KEY, payload: { requestKey: "autre" } }),
    ).toBe(false);
    expect(isAutoReplayable({ method: "POST", endpoint: "/api/missions/4/fuel-records", idempotencyKey: KEY, payload: {} })).toBe(false);
  });

  it("refuse les routes non protégées connues et tout endpoint hors /api/", () => {
    expect(isAutoReplayable({ method: "POST", endpoint: "/api/vehicles/1/mileage", idempotencyKey: KEY })).toBe(false);
    expect(isAutoReplayable({ method: "POST", endpoint: "/api/work-orders/1/notes", idempotencyKey: KEY })).toBe(false);
    expect(isAutoReplayable({ method: "PUT", endpoint: "https://x.example/api/vehicles/1/mileage", idempotencyKey: KEY })).toBe(false);
    expect(isAutoReplayable({ method: "PUT", endpoint: "/api/vehicles/1/mileage", idempotencyKey: KEY })).toBe(true);
  });

  it("work_order_note n'est plus enregistré, odometer_reading est un PUT", () => {
    expect(getOfflineAction("work_order_note")).toBeUndefined();
    expect(getOfflineAction("odometer_reading")?.method).toBe("PUT");
  });
});
