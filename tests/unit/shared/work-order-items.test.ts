import { describe, it, expect } from "vitest";
import {
  computeWorkOrderItemTotals,
  getWorkOrderItemStatusLabel,
  parseHours,
  resolveWorkOrderItemLabel,
  validateWorkOrderItem,
} from "@shared/constants/work-order-items";

describe("computeWorkOrderItemTotals", () => {
  it("somme les heures réelles de plusieurs lignes", () => {
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 2.5, status: "done" },
      { actualHours: "1.25", status: "done" },
      { actualHours: 0.25, status: "in_progress" },
    ]);

    expect(totaux.actualHours).toBe(4);
    expect(totaux.lineCount).toBe(3);
    expect(totaux.measuredLineCount).toBe(3);
    expect(totaux.unmeasuredLineCount).toBe(0);
  });

  it("exclut du total une ligne sans heures réelles, sans la compter à zéro", () => {
    // Une ligne non mesurée doit rester visible comme non mesurée: la compter
    // à zéro ferait croire à un travail instantané.
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 3, status: "done" },
      { actualHours: null, status: "pending" },
      { actualHours: "", status: "in_progress" },
    ]);

    expect(totaux.actualHours).toBe(3);
    expect(totaux.measuredLineCount).toBe(1);
    expect(totaux.unmeasuredLineCount).toBe(2);
  });

  it("renvoie null quand aucune ligne n'est mesurée", () => {
    const totaux = computeWorkOrderItemTotals([
      { estimatedHours: 2, status: "pending" },
      { estimatedHours: 1, status: "pending" },
    ]);

    expect(totaux.actualHours).toBeNull();
    expect(totaux.estimatedHours).toBe(3);
    expect(totaux.unmeasuredLineCount).toBe(2);
  });

  it("écarte les lignes annulées de tous les totaux", () => {
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 4, status: "done" },
      { actualHours: 10, estimatedHours: 8, status: "cancelled" },
    ]);

    expect(totaux.lineCount).toBe(1);
    expect(totaux.actualHours).toBe(4);
    expect(totaux.estimatedHours).toBeNull();
  });

  it("calcule l'écart au barème quand standardHours existe", () => {
    // 6 h passées sur une vidange dont le barème est 1 h: l'information utile.
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 6, standardHours: 1, status: "done" },
      { actualHours: 2, standardHours: 3, status: "done" },
    ]);

    expect(totaux.standardHours).toBe(4);
    expect(totaux.varianceHours).toBe(4);
  });

  it("ne calcule aucun écart quand le barème est absent", () => {
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 6, standardHours: null, status: "done" },
      { actualHours: 2, status: "done" },
    ]);

    expect(totaux.actualHours).toBe(8);
    expect(totaux.standardHours).toBeNull();
    expect(totaux.varianceHours).toBeNull();
  });

  it("n'oppose au barème que les lignes qui portent les deux valeurs", () => {
    // La ligne hors catalogue compte dans le réel, jamais dans l'écart:
    // sinon elle produirait un dépassement imaginaire.
    const totaux = computeWorkOrderItemTotals([
      { actualHours: 5, standardHours: 2, status: "done" },
      { actualHours: 9, status: "done" },
      { actualHours: null, standardHours: 4, status: "pending" },
    ]);

    expect(totaux.actualHours).toBe(14);
    expect(totaux.standardHours).toBe(2);
    expect(totaux.varianceHours).toBe(3);
  });

  it("renvoie des totaux vides pour une intervention sans ligne", () => {
    const totaux = computeWorkOrderItemTotals([]);

    expect(totaux).toMatchObject({
      lineCount: 0,
      measuredLineCount: 0,
      actualHours: null,
      varianceHours: null,
    });
  });
});

describe("validateWorkOrderItem", () => {
  it("exige un libellé quand la ligne est hors catalogue", () => {
    const verdict = validateWorkOrderItem({ laborCatalogId: null, customLabel: "   " });

    expect(verdict.valid).toBe(false);
    expect(verdict.errors[0]).toContain("libellé");
  });

  it("accepte une ligne hors catalogue avec un libellé libre", () => {
    expect(validateWorkOrderItem({ customLabel: "Reprise soudure châssis" }).valid).toBe(true);
  });

  it("accepte une ligne rattachée au catalogue sans libellé libre", () => {
    expect(validateWorkOrderItem({ laborCatalogId: 12 }).valid).toBe(true);
  });

  it("refuse des heures négatives", () => {
    const verdict = validateWorkOrderItem({ laborCatalogId: 12, actualHours: -2 });

    expect(verdict.valid).toBe(false);
    expect(verdict.errors[0]).toContain("réelles");
  });

  it("refuse des heures au-delà de la capacité de la colonne", () => {
    expect(validateWorkOrderItem({ laborCatalogId: 12, estimatedHours: 1500 }).valid).toBe(false);
  });

  it("refuse un statut de ligne inconnu", () => {
    expect(validateWorkOrderItem({ laborCatalogId: 12, status: "archived" }).valid).toBe(false);
  });
});

describe("parseHours", () => {
  it("lit les numeric renvoyés en chaîne par Postgres", () => {
    expect(parseHours("2.50")).toBe(2.5);
  });

  it("traite l'absence de mesure comme inconnue, pas comme zéro", () => {
    expect(parseHours(null)).toBeNull();
    expect(parseHours("")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(parseHours(-1)).toBeNull();
  });
});

describe("resolveWorkOrderItemLabel", () => {
  it("fait primer le poste catalogue sur le texte libre", () => {
    expect(
      resolveWorkOrderItemLabel({ laborCatalogLabel: "Vidange moteur", customLabel: "vidange" }),
    ).toBe("Vidange moteur");
  });

  it("retombe sur le libellé libre hors catalogue", () => {
    expect(resolveWorkOrderItemLabel({ customLabel: "Reprise soudure" })).toBe("Reprise soudure");
  });
});

describe("getWorkOrderItemStatusLabel", () => {
  it("décrit la ligne suivie, pas l'action", () => {
    expect(getWorkOrderItemStatusLabel("done")).toBe("Terminée");
    expect(getWorkOrderItemStatusLabel("pending")).toBe("À faire");
  });

  it("renvoie la valeur brute pour un statut inconnu", () => {
    expect(getWorkOrderItemStatusLabel("inconnu")).toBe("inconnu");
  });
});
