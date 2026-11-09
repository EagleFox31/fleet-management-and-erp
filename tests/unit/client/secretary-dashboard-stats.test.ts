import { describe, expect, it } from "vitest";
import { UNAVAILABLE } from "../../../client/src/components/dashboard/kpi-tiles";
import { parseStatNumber as parseFromTires } from "../../../client/src/lib/tire-statistics-view";
import { parseStatNumber, statField, sumField, sumKnown } from "../../../client/src/lib/stat-number";
import {
  LOADING_VALUE,
  clientTotals,
  countSentence,
  documentRenewals,
  isPositive,
  statDisplay,
} from "../../../client/src/lib/secretary-dashboard-stats";

describe("stat-number", () => {
  it("parseStatNumber reste exporté par tire-statistics-view (même fonction)", () => {
    expect(parseFromTires).toBe(parseStatNumber);
  });

  it("statField : objet absent ou champ illisible → null, zéro réel gardé", () => {
    expect(statField(undefined, "total")).toBeNull();
    expect(statField({ total: "abc" }, "total")).toBeNull();
    expect(statField({}, "total")).toBeNull();
    expect(statField({ total: 0 }, "total")).toBe(0);
    expect(statField({ total: "12.5" }, "total")).toBe(12.5);
  });

  it("sumKnown : un terme inconnu rend la somme inconnue, jamais partielle", () => {
    expect(sumKnown([1, 2, 3])).toBe(6);
    expect(sumKnown([1, null, 3])).toBeNull();
    expect(sumKnown([])).toBe(0);
  });

  it("sumField : liste absente → null ; liste vide → 0 (vraiment aucun client)", () => {
    expect(sumField(null, "x")).toBeNull();
    expect(sumField([], "x")).toBe(0);
    expect(sumField([{ x: 2 }, { x: "3" }], "x")).toBe(5);
    expect(sumField([{ x: 2 }, { y: 3 }], "x")).toBeNull();
  });
});

describe("documentRenewals", () => {
  const stats = {
    expiringCarteGrise: 1, expiringAssurance: 2, expiringVisiteTechnique: 0,
    expiredCarteGrise: 0, expiredAssurance: 1, expiredVisiteTechnique: 3,
  };

  it("additionne les trois documents", () => {
    expect(documentRenewals(stats)).toEqual({ expiringSoon: 3, expired: 4, toRenew: 7 });
  });

  it("un compteur manquant : sa somme et le total sont inconnus", () => {
    const { expiredVisiteTechnique: _, ...partial } = stats;
    expect(documentRenewals(partial)).toEqual({ expiringSoon: 3, expired: null, toRenew: null });
    expect(documentRenewals(undefined)).toEqual({ expiringSoon: null, expired: null, toRenew: null });
  });
});

describe("clientTotals", () => {
  it("coût lu dans totalFuelCost, le champ servi par la route", () => {
    const list = [
      { totalMissions: 2, totalRevenue: 1000, totalFuelCost: 400 },
      { totalMissions: 1, totalRevenue: 500, totalFuelCost: 100 },
    ];
    expect(clientTotals(list)).toEqual({ missions: 3, estimatedFuelCost: 1500, fuelCost: 500 });
  });

  it("totalRevenue (somme des carburants estimés) n'est jamais exposé comme chiffre d'affaires", () => {
    const totals = clientTotals([{ totalMissions: 1, totalRevenue: 700, totalFuelCost: 650 }]);
    expect(totals.estimatedFuelCost).toBe(700);
    expect(Object.keys(totals)).not.toContain("revenue");
  });

  it("liste illisible : tout inconnu, pas 0 F", () => {
    expect(clientTotals(null)).toEqual({ missions: null, estimatedFuelCost: null, fuelCost: null });
  });
});

describe("statDisplay", () => {
  const ready = { kind: "ready", data: {} } as const;

  it("chargement : « … », ni 0 ni Indisponible", () => {
    expect(statDisplay({ kind: "loading" }, null)).toBe(LOADING_VALUE);
  });

  it("échec ou valeur illisible : Indisponible", () => {
    expect(statDisplay({ kind: "error", error: null, isRetrying: false }, 5)).toBe(UNAVAILABLE);
    expect(statDisplay(ready, null)).toBe(UNAVAILABLE);
  });

  it("valeur connue : affichée, zéro compris, formatée si demandé", () => {
    expect(statDisplay(ready, 0)).toBe(0);
    expect(statDisplay(ready, 1500, (n) => `${n} F`)).toBe("1500 F");
  });
});

describe("countSentence et isPositive", () => {
  const ready = { kind: "ready", data: [] } as const;
  const sentence = (n: number) => `${n} véhicule(s)`;

  it("phrase seulement pour un compte connu", () => {
    expect(countSentence({ kind: "loading" }, null, sentence, "Véhicules indisponibles")).toBe(LOADING_VALUE);
    expect(countSentence({ kind: "error", error: null, isRetrying: false }, 3, sentence, "Véhicules indisponibles"))
      .toBe("Véhicules indisponibles");
    expect(countSentence(ready, null, sentence, "Véhicules indisponibles")).toBe("Véhicules indisponibles");
    expect(countSentence(ready, 0, sentence, "Véhicules indisponibles")).toBe("0 véhicule(s)");
  });

  it("couleur d'alerte : compte connu et non nul", () => {
    expect(isPositive(null)).toBe(false);
    expect(isPositive(0)).toBe(false);
    expect(isPositive(2)).toBe(true);
  });
});
