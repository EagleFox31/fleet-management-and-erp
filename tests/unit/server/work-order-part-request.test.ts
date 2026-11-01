import { describe, expect, it } from "vitest";
import { describePartRequest, splitPartRequest } from "../../../server/lib/part-request";

/**
 * « Demander la pièce » depuis un OT : partage entre ce qui est en rayon (à
 * sortir par le magasinier) et ce qui part en demande. Rien ne sort au clic.
 */

describe("splitPartRequest", () => {
  it("rayon suffisant : tout attend le magasinier, rien n'est demandé", () => {
    expect(splitPartRequest(3, 10)).toEqual({ inStock: 3, missing: 0 });
    expect(splitPartRequest(4, 4)).toEqual({ inStock: 4, missing: 0 });
  });

  it("rayon partiel : le disponible attend le magasinier, le manquant est demandé", () => {
    expect(splitPartRequest(5, 2)).toEqual({ inStock: 2, missing: 3 });
  });

  it("rayon vide : tout est demandé", () => {
    expect(splitPartRequest(2, 0)).toEqual({ inStock: 0, missing: 2 });
  });

  it("un disponible négatif (stock promis à d'autres demandes) ne promet rien", () => {
    expect(splitPartRequest(2, -3)).toEqual({ inStock: 0, missing: 2 });
  });
});

describe("describePartRequest", () => {
  it("en rayon : annonce la sortie par le magasinier, ni demande ni attente", () => {
    const message = describePartRequest({ toIssue: 2, missing: 0 });
    expect(message).toBe("2 en rayon : demande transmise au magasinier, qui sortira la pièce.");
  });

  it("rayon partiel : annonce aussi la demande et l'attente", () => {
    const message = describePartRequest({ toIssue: 2, missing: 3 });
    expect(message).toContain("2 en rayon");
    expect(message).toContain("Demande de pièce créée pour 3 unité(s) manquante(s).");
    expect(message).toContain("L'OT est en attente de pièces.");
  });

  it("rayon vide : demande et attente", () => {
    const message = describePartRequest({ toIssue: 0, missing: 1 });
    expect(message).toContain("Aucune pièce disponible en rayon.");
    expect(message).toContain("L'OT est en attente de pièces.");
  });

  it("demande déjà en cours : cite son statut par le libellé partagé, rien d'autre", () => {
    const message = describePartRequest({ toIssue: 0, missing: 0, existingStatus: "approved" });
    expect(message).toBe("Une demande est déjà en cours pour cette pièce (Approuvée).");
  });
});
