import { describe, expect, it } from "vitest";
import { formatKnownCost, listQueryView, workOrderDisplayCost } from "@/lib/work-order-tires-cost";

/**
 * Fiche OT : si la lecture des rotations de pneus échoue, le coût pneus n'est pas 0.
 * Constat du 7 novembre 2026 (#592) : `data = []` par défaut, le coût de l'OT était
 * sous-évalué sans aucun signal à l'écran ni dans le PDF.
 */
const base = { baseCost: 1000, parts: [{ unitPrice: 50, quantity: 2 }], laborHours: 0, laborRate: null };

describe("coût d'OT affiché, rotations de pneus", () => {
  it("rotations lues : coût pneus compté dans le total", () => {
    expect(workOrderDisplayCost({ ...base, tireRotations: [{ cost: 300 }] })).toMatchObject({
      baseCost: 1000,
      partsCost: 100,
      tiresCost: 300,
      totalCost: 1400,
    });
  });

  it("rotations lues et vides : 0 est un vrai zéro", () => {
    expect(workOrderDisplayCost({ ...base, tireRotations: [] })).toMatchObject({ tiresCost: 0, totalCost: 1100 });
  });

  it("rotations jamais lues (échec ou chargement) : coût pneus et total inconnus, pas 0", () => {
    const cost = workOrderDisplayCost({ ...base, tireRotations: undefined });
    expect(cost).toMatchObject({ baseCost: 1000, partsCost: 100, tiresCost: null, totalCost: null });
  });

  it("réponse qui n'est pas une liste : inconnue aussi", () => {
    expect(workOrderDisplayCost({ ...base, tireRotations: { message: "x" } as never }).totalCost).toBeNull();
  });
});

describe("vue d'une requête de liste", () => {
  const error = new Error("panne");

  it("erreur sans données : erreur", () => {
    expect(listQueryView({ data: undefined, error, isFetching: false })).toEqual({
      kind: "error",
      error,
      isRetrying: false,
    });
  });

  it("réponse 200 qui n'est pas une liste : erreur, pas un chargement sans fin", () => {
    expect(listQueryView({ data: { message: "x" }, error: null, isFetching: false })).toMatchObject({ kind: "error" });
  });

  it("chargement en cours : chargement", () => {
    expect(listQueryView({ data: undefined, error: null, isFetching: true })).toEqual({ kind: "loading" });
  });

  it("relance en échec avec une liste en cache : les données restent", () => {
    expect(listQueryView({ data: [{ id: 1 }], error, isFetching: false })).toEqual({ kind: "ready", data: [{ id: 1 }] });
  });
});

describe("libellé d'un montant", () => {
  const fmt = (n: number) => `${n} FCFA`;

  it("montant connu : formaté", () => {
    expect(formatKnownCost(0, fmt, { isError: false })).toBe("0 FCFA");
  });

  it("inconnu après échec : Indisponible", () => {
    expect(formatKnownCost(null, fmt, { isError: true })).toBe("Indisponible");
  });

  it("inconnu pendant le chargement : pas de zéro non plus", () => {
    expect(formatKnownCost(null, fmt, { isError: false })).toBe("Chargement…");
  });
});
