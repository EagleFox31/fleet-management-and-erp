import { describe, expect, it } from "vitest";
import {
  REGULARIZATION_REQUEST_KEY_PATTERN,
  findMissionRegularization,
  isSameRegularization,
} from "../../../server/lib/mission-fuel-regularization";
import { newRequestKey } from "../../../client/src/lib/request-key";

const workflowData = {
  budgetPlan: { fuelBudget: 1 },
  fuelTracking: {
    regularizations: [
      { id: 2, requestKey: "cle-recente", quantity: 3, unitPrice: 100, vehicleId: 7 },
      "entrée corrompue",
      { id: 1, quantity: 2, unitPrice: 100 }, // entrée antérieure à la clé
    ],
  },
};

describe("journal de régularisation : recherche par clé", () => {
  it("retrouve l'entrée portant la clé", () => {
    expect(findMissionRegularization(workflowData, "cle-recente")?.id).toBe(2);
  });

  it("aucune entrée pour une clé inconnue ou un workflowData vide", () => {
    expect(findMissionRegularization(workflowData, "cle-absente")).toBeNull();
    expect(findMissionRegularization(null, "cle-recente")).toBeNull();
    expect(findMissionRegularization({ fuelTracking: { regularizations: "x" } }, "cle-recente")).toBeNull();
  });

  it("même plein : quantité, prix et véhicule identiques", () => {
    const entry = findMissionRegularization(workflowData, "cle-recente")!;
    expect(isSameRegularization(entry, { vehicleId: 7, quantity: 3, unitPrice: 100 })).toBe(true);
    expect(isSameRegularization(entry, { vehicleId: 7, quantity: 4, unitPrice: 100 })).toBe(false);
    expect(isSameRegularization(entry, { vehicleId: 8, quantity: 3, unitPrice: 100 })).toBe(false);
  });
});

describe("clé de requête client", () => {
  it("est acceptée par le serveur et change à chaque soumission", () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).toMatch(REGULARIZATION_REQUEST_KEY_PATTERN);
    expect(a).not.toBe(b);
  });

  it("repli sans randomUUID (contexte non sécurisé)", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newRequestKey()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
