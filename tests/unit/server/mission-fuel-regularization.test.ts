import { describe, expect, it } from "vitest";
import {
  MISSION_FUEL_REQUEST_KEY_PATTERN,
  buildFuelConsumptionNotes,
  findMissionRegularization,
  isSameFuelSubmission,
  type FuelSubmission,
  type StoredFuelRecord,
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

});

describe("rejeu d'un plein : même soumission ou 409", () => {
  const notes = buildFuelConsumptionNotes({ notes: "[REGULARISATION] ticket retrouvé", destination: "Douala" });
  const stored: StoredFuelRecord = {
    missionId: 5,
    vehicleId: 7,
    quantity: 33.3, // real : relu tel quel
    unitPrice: "650.56", // numeric(15,2) : arrondi au centime
    date: "2026-11-03",
    stationName: "TOTAL BONABERI",
    notes,
  };
  const sent: FuelSubmission = {
    missionId: 5,
    vehicleId: 7,
    quantity: 33.3,
    unitPrice: 650.555,
    date: "2026-11-03",
    stationName: "TOTAL BONABERI",
    notes,
  };

  it("même plein, prix comparé à la précision stockée", () => {
    expect(isSameFuelSubmission(stored, sent)).toBe(true);
  });

  it("date non fournie : non comparée (le serveur prend maintenant)", () => {
    expect(isSameFuelSubmission(stored, { ...sent, date: null })).toBe(true);
  });

  it.each([
    ["mission", { missionId: 6 }],
    ["véhicule", { vehicleId: 8 }],
    ["quantité", { quantity: 33.4 }],
    ["prix", { unitPrice: 651 }],
    ["date", { date: "2026-11-02" }],
    ["station", { stationName: "TOTAL AKWA" }],
    ["motif (notes)", { notes: buildFuelConsumptionNotes({ notes: "[REGULARISATION] autre motif", destination: "Douala" }) }],
  ])("%s différent : autre plein", (_label, change) => {
    expect(isSameFuelSubmission(stored, { ...sent, ...change })).toBe(false);
  });

  it("notes écrites comme par le service (départ, notes, destination, client)", () => {
    expect(buildFuelConsumptionNotes({ isPreDeparture: true, notes: "  n ", destination: "Kribi", clientName: "ACME" }))
      .toBe("[PRE_DEPART] | n | Destination: Kribi - Client: ACME");
  });
});

describe("clé de requête client", () => {
  it("est acceptée par le serveur et change à chaque soumission", () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).toMatch(MISSION_FUEL_REQUEST_KEY_PATTERN);
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
