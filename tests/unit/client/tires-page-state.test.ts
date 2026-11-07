import { describe, expect, it } from "vitest";
import { tiresPageState } from "@/lib/tires-page-state";

/**
 * /inventory/tires : une requête en échec donne un état d'erreur, pas une page vide.
 * Constat du 7 novembre 2026 : statistiques en échec, page affichée avec des zéros et sans message.
 */
const ok = { isLoading: false, error: null };
const loading = { isLoading: true, error: null };
const failed = (error: unknown) => ({ isLoading: false, error });

describe("état de la page des pneus", () => {
  it("une requête encore en cours : chargement", () => {
    expect(tiresPageState(loading, ok)).toEqual({ kind: "loading" });
    expect(tiresPageState(ok, loading)).toEqual({ kind: "loading" });
  });

  it("statistiques en échec : erreur, avec l'erreur reçue", () => {
    const error = new Error("statistiques");
    expect(tiresPageState(ok, failed(error))).toEqual({ kind: "error", error });
  });

  it("liste en échec : erreur, prioritaire sur celle des statistiques", () => {
    const listError = new Error("liste");
    expect(tiresPageState(failed(listError), failed(new Error("stats")))).toEqual({ kind: "error", error: listError });
  });

  it("chargement fini sans erreur : page prête", () => {
    expect(tiresPageState(ok, ok)).toEqual({ kind: "ready" });
  });
});
