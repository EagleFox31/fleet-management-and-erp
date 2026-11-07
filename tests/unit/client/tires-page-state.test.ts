import { describe, expect, it } from "vitest";
import { tiresPageState } from "@/lib/tires-page-state";

/**
 * /inventory/tires : une requête en échec donne un état d'erreur, pas une page vide.
 * Constat du 7 novembre 2026 : statistiques en échec, page affichée avec des zéros et sans message.
 *
 * Relecture de #591 : une relance en échec (temps réel, pool saturé) ne doit pas effacer une
 * liste déjà affichée ni ses dialogues ouverts. Seule une requête sans données bloque la page.
 */
const ok = { isLoading: false, isFetching: false, error: null, data: { tires: [] } };
const loading = { isLoading: true, isFetching: true, error: null, data: undefined };
const failed = (error: unknown) => ({ isLoading: false, isFetching: false, error, data: undefined });
const cachedButRefetchFailed = (error: unknown) => ({ isLoading: false, isFetching: false, error, data: { tires: [] } });

describe("état de la page des pneus", () => {
  it("une requête encore en cours : chargement", () => {
    expect(tiresPageState(loading, ok)).toEqual({ kind: "loading" });
    expect(tiresPageState(ok, loading)).toEqual({ kind: "loading" });
  });

  it("liste en échec sans données : page en erreur, avec l'erreur reçue", () => {
    const listError = new Error("liste");
    expect(tiresPageState(failed(listError), failed(new Error("stats")))).toEqual({
      kind: "error",
      error: listError,
      isRetrying: false,
    });
  });

  it("liste en cache et relance en échec : la liste reste affichée", () => {
    expect(tiresPageState(cachedButRefetchFailed(new Error("relance")), ok)).toEqual({ kind: "ready", statsError: null });
  });

  it("statistiques en échec sans données : liste affichée, encart d'erreur sur les indicateurs", () => {
    const error = new Error("statistiques");
    expect(tiresPageState(ok, failed(error))).toEqual({ kind: "ready", statsError: { error, isRetrying: false } });
  });

  it("statistiques en cache et relance en échec : indicateurs conservés, pas d'encart", () => {
    expect(tiresPageState(ok, cachedButRefetchFailed(new Error("relance")))).toEqual({ kind: "ready", statsError: null });
  });

  it("nouvel essai en cours : bouton Réessayer désactivé", () => {
    const error = new Error("liste");
    expect(tiresPageState({ ...failed(error), isFetching: true }, ok)).toMatchObject({ kind: "error", isRetrying: true });
    expect(tiresPageState(ok, { ...failed(error), isFetching: true })).toMatchObject({
      kind: "ready",
      statsError: { isRetrying: true },
    });
  });

  it("chargement fini sans erreur : page prête", () => {
    expect(tiresPageState(ok, ok)).toEqual({ kind: "ready", statsError: null });
  });
});
