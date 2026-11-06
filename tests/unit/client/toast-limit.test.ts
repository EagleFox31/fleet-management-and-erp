import { describe, it, expect } from "vitest";
import { reducer } from "@/hooks/use-toast";

/**
 * Une alerte temps réel (`alert_created`) affiche un toast à tout moment. Avec une
 * limite à 1, elle remplaçait le toast d'erreur d'une action en moins d'une seconde :
 * l'utilisateur ne lisait jamais pourquoi son paiement était refusé (vu en e2e).
 */

const toast = (id: string, variant?: "destructive") => ({ id, title: id, variant, open: true });

describe("use-toast reducer", () => {
  it("un toast d'alerte n'efface pas le toast d'erreur affiché", () => {
    const withError = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: toast("refus", "destructive") });
    const next = reducer(withError, { type: "ADD_TOAST", toast: toast("Document expiré") });

    expect(next.toasts.map((t) => t.id)).toEqual(["Document expiré", "refus"]);
  });

  it("le nombre de toasts visibles reste borné, les plus anciens sortent", () => {
    let state: ReturnType<typeof reducer> = { toasts: [] };
    for (const id of ["a", "b", "c", "d"]) {
      state = reducer(state, { type: "ADD_TOAST", toast: toast(id) });
    }

    expect(state.toasts.map((t) => t.id)).toEqual(["d", "c", "b"]);
  });
});
