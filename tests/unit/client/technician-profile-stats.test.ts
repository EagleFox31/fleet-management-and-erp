import { describe, expect, it } from "vitest";
import { technicianProfileStats, technicianProfileView } from "../../../client/src/lib/technician-profile-stats";

/**
 * Profil technicien : un échec de chargement n'est pas un coût nul.
 * Avant ce correctif, la page ne lisait que `isLoading` : sur une erreur, `workOrders` valait `[]`
 * et tous les coûts s'affichaient à 0 comme de vraies valeurs.
 */
describe("technicianProfileView", () => {
  it("erreur sans données : état error, pas de statistiques à 0", () => {
    const failure = new Error("500");
    const view = technicianProfileView({ data: undefined, error: failure, isFetching: false });
    expect(view).toEqual({ kind: "error", error: failure, isRetrying: false });
  });

  it("relance en cours : Réessayer est désactivé", () => {
    const view = technicianProfileView({ data: undefined, error: new Error("500"), isFetching: true });
    expect(view.kind === "error" && view.isRetrying).toBe(true);
  });

  it("réponse sans liste d'OT : error, jamais un profil vide", () => {
    expect(technicianProfileView({ data: { stats: {} }, error: null, isFetching: false }).kind).toBe("error");
    expect(technicianProfileView({ data: null, error: null, isFetching: false }).kind).toBe("error");
  });

  it("premier chargement : loading", () => {
    expect(technicianProfileView({ data: undefined, error: null, isFetching: true }).kind).toBe("loading");
  });

  it("données en cache et relance échouée : les données restent affichées", () => {
    const view = technicianProfileView({
      data: { workOrders: [{ status: "completed", cost: 120, baseCost: 100, partsCost: 20, tiresCost: 0 }] },
      error: new Error("500"),
      isFetching: false,
    });
    expect(view.kind).toBe("ready");
    expect(view.kind === "ready" && view.data.totalCost).toBe(120);
  });
});

describe("technicianProfileStats", () => {
  it("somme les coûts des seuls OT terminés", () => {
    const stats = technicianProfileStats([
      { status: "completed", cost: 300, baseCost: 200, partsCost: 60, tiresCost: 40 },
      { status: "completed", cost: "100", baseCost: "100", partsCost: 0, tiresCost: 0 },
      { status: "in_progress", cost: 999, baseCost: 999 },
      { status: "pending", cost: 5 },
    ]);
    expect(stats.totalCost).toBe(400);
    expect(stats.averageCost).toBe(200);
    expect(stats.maintenanceCost).toBe(300);
    expect(stats.partsCost).toBe(60);
    expect(stats.tiresCost).toBe(40);
    expect([stats.completed.length, stats.inProgress.length, stats.pending.length]).toEqual([2, 1, 1]);
  });

  it("sans détail du coût, la maintenance reprend le total", () => {
    const stats = technicianProfileStats([{ status: "completed", cost: 250 }]);
    expect(stats.maintenanceCost).toBe(250);
  });
});
