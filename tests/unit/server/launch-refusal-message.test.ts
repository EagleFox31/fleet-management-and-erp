import { describe, expect, it } from "vitest";
import { looksTechnical } from "../../../shared/errors";
import { launchRefusalMessage } from "../../../server/services/mission-planning";

describe("launchRefusalMessage", () => {
  it("peu de motifs : tous listés, consigne ajoutée seulement pour le chauffeur", () => {
    const motifs = ["Budget carburant non renseigné.", "Assurance manquante ou expirée."];
    expect(launchRefusalMessage(motifs, { forDriver: false })).toBe(
      "Impossible de lancer la mission : Budget carburant non renseigné. Assurance manquante ou expirée.",
    );
    expect(launchRefusalMessage(motifs, { forDriver: true })).toMatch(/ Contactez l'exploitation\.$/);
  });

  it("conflit et budget passent avant les autres motifs", () => {
    const message = launchRefusalMessage(["Carte grise manquante.", "Conflit planning détecté sur ce véhicule ou ce chauffeur.", "Budget imprévus non renseigné."], { forDriver: false });
    expect(message.indexOf("Conflit")).toBeLessThan(message.indexOf("Budget"));
    expect(message.indexOf("Budget")).toBeLessThan(message.indexOf("Carte grise"));
  });

  it("trop de motifs : les premiers qui tiennent, les autres comptés, message lisible", () => {
    const motifs = Array.from({ length: 12 }, (_, i) => `Motif numéro ${i} à corriger avant le départ.`);
    const message = launchRefusalMessage(motifs, { forDriver: true });
    expect(message).toMatch(/\(et \d+ autres points à corriger\)/);
    expect(message.length).toBeLessThanOrEqual(300);
    expect(looksTechnical(message)).toBe(false);
  });

  it("un motif trop long est sauté sans vider le message", () => {
    const long = `Affectation incomplète ${"x".repeat(400)}.`;
    const message = launchRefusalMessage([long, "Assurance manquante ou expirée."], { forDriver: false });
    // Aucun motif urgent : le long passe en premier, `break` viderait le message, `continue` garde le suivant.
    expect(message).toContain("Assurance manquante ou expirée.");
    expect(message).toContain("(et 1 autre point à corriger)");
  });

  it("un seul point caché : singulier", () => {
    const message = launchRefusalMessage(["Budget carburant non renseigné.", `Autre ${"y".repeat(300)}`], { forDriver: false });
    expect(message).toContain("(et 1 autre point à corriger)");
  });
});
