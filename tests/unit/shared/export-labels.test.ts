import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES, ROLE_LABELS } from "@shared/constants/roles";
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_STATUSES,
  WORK_ORDER_STATUS_LABELS,
} from "@shared/constants/work-orders";
import { workOrders } from "@shared/schema";

/** Chaque valeur d'enum du schema a un libelle francais non vide (exports et UI). */
describe("libelles d'enums partages", () => {
  it.each([
    ["roles", ALL_APP_ROLES, ROLE_LABELS],
    ["statuts d'OT", WORK_ORDER_STATUSES, WORK_ORDER_STATUS_LABELS],
    ["priorites d'OT", WORK_ORDER_PRIORITIES, WORK_ORDER_PRIORITY_LABELS],
  ] as const)("%s : aucun libelle manquant ni vide", (_nom, valeurs, labels) => {
    expect(valeurs.length).toBeGreaterThan(0);
    for (const v of valeurs) {
      const label = (labels as Record<string, string>)[v];
      expect(label?.trim(), v).toBeTruthy();
    }
    expect(Object.keys(labels).sort()).toEqual([...valeurs].sort());
  });

  it("la liste des statuts (work-order-transitions.ts) reste celle de l'enum du schema", () => {
    expect([...WORK_ORDER_STATUSES].sort()).toEqual([...workOrders.status.enumValues].sort());
  });

  it("couvre les valeurs reelles de l'ancien defaut", () => {
    expect(WORK_ORDER_STATUS_LABELS.awaiting_parts).toBe("Attente pièces");
    expect(WORK_ORDER_PRIORITY_LABELS.critical).toBe("Critique");
    expect(ROLE_LABELS.warehouse).toBe("Magasinier");
  });
});
