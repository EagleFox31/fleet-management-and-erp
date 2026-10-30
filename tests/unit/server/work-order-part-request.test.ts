import { describe, expect, it } from "vitest";
import { describePartRequest, splitPartRequest } from "../../../server/lib/part-request";

/**
 * « Demander la pièce » depuis un OT : partage entre ce qui sort du stock et ce
 * qui part en demande. Le stock ne devient jamais négatif.
 */

describe("splitPartRequest", () => {
  it("stock suffisant : tout sort, rien n'est demandé", () => {
    expect(splitPartRequest(3, 10)).toEqual({ issued: 3, missing: 0 });
    expect(splitPartRequest(4, 4)).toEqual({ issued: 4, missing: 0 });
  });

  it("stock partiel : le disponible sort, le manquant est demandé", () => {
    expect(splitPartRequest(5, 2)).toEqual({ issued: 2, missing: 3 });
  });

  it("stock épuisé : tout est demandé", () => {
    expect(splitPartRequest(2, 0)).toEqual({ issued: 0, missing: 2 });
  });

  it("un stock déjà négatif en base ne fait rien sortir", () => {
    expect(splitPartRequest(2, -3)).toEqual({ issued: 0, missing: 2 });
  });
});

describe("describePartRequest", () => {
  it("sortie complète : pas de mention de demande ni d'attente", () => {
    const message = describePartRequest({ issued: 2, missing: 0 });
    expect(message).toBe("2 sortie(s) du stock et ajoutée(s) à l'OT.");
  });

  it("sortie partielle : annonce la demande et l'attente", () => {
    const message = describePartRequest({ issued: 2, missing: 3 });
    expect(message).toContain("2 sortie(s) du stock");
    expect(message).toContain("Demande de pièce créée pour 3 unité(s) manquante(s).");
    expect(message).toContain("L'OT est en attente de pièces.");
  });

  it("demande déjà en cours : cite son statut par le libellé partagé", () => {
    const message = describePartRequest({ issued: 0, missing: 1, existingStatus: "approved" });
    expect(message).toContain("Stock épuisé.");
    expect(message).toContain("Une demande est déjà en cours pour cette pièce (Approuvée).");
    expect(message).not.toContain("Demande de pièce créée");
  });
});
