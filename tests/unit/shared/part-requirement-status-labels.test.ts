import { describe, it, expect } from "vitest";
import {
  getPartRequirementStatusLabel,
  getPartRequirementProgressLabel,
  PART_REQUIREMENT_STATUS_LABELS,
} from "@shared/constants/part-requirements";

describe("getPartRequirementStatusLabel", () => {
  it("décrit la demande, pas l'action : received / issued en paire magasin", () => {
    expect(getPartRequirementStatusLabel("received")).toBe("Entrée en stock");
    expect(getPartRequirementStatusLabel("issued")).toBe("Sortie du stock");
  });

  it("n'utilise pas les libellés interdits pour issued", () => {
    const label = getPartRequirementStatusLabel("issued");
    expect(label).not.toBe("Terminé");
    expect(label).not.toBe("Affecté à l'OT");
    expect(label).not.toBe("Sortie validée");
  });

  it("aligne fulfilled sur Utilisée (plus Installée / Utilisée divergents)", () => {
    expect(getPartRequirementStatusLabel("fulfilled")).toBe("Utilisée");
    expect(getPartRequirementStatusLabel("fulfilled")).not.toBe("Installée");
  });

  it("couvre toute la table partagée", () => {
    for (const [status, expected] of Object.entries(PART_REQUIREMENT_STATUS_LABELS)) {
      expect(getPartRequirementStatusLabel(status)).toBe(expected);
    }
  });

  it("renvoie le statut brut s'il est inconnu", () => {
    expect(getPartRequirementStatusLabel("invented_status")).toBe("invented_status");
  });
});

describe("getPartRequirementProgressLabel", () => {
  it("nomme qui doit valider une demande en attente", () => {
    expect(getPartRequirementProgressLabel("pending", "technician")).toBe(
      "En attente de validation par le chef d'atelier",
    );
  });

  it("bascule sur la secrétaire quand le chef d'atelier est le demandeur", () => {
    // Séparation des tâches: un chef d'atelier ne s'auto-approuve pas.
    expect(getPartRequirementProgressLabel("pending", "workshop_manager")).toBe(
      "En attente de validation par la secrétaire",
    );
  });

  it("dit ce qu'on attend, pas seulement l'étape en cours", () => {
    expect(getPartRequirementProgressLabel("ordered")).toBe(
      "Commandée — en attente de livraison",
    );
    expect(getPartRequirementProgressLabel("delivered")).toBe(
      "Livrée — en attente de réception au magasin",
    );
    expect(getPartRequirementProgressLabel("received")).toBe("Prête au magasin");
  });

  it("traite partial comme partially_received", () => {
    expect(getPartRequirementProgressLabel("partial")).toBe(
      getPartRequirementProgressLabel("partially_received"),
    );
  });

  it("retombe sur le libellé de statut pour un statut hors circuit", () => {
    // `issued` n'attend plus rien: pas de phrase d'attente inventée.
    expect(getPartRequirementProgressLabel("issued")).toBe("Sortie du stock");
  });
});
