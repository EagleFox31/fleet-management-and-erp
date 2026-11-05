import { describe, expect, it } from "vitest";
import { INVENTORY_MANAGER_ROLES } from "../../../shared/constants/roles";
import { STATUS_PERMISSIONS } from "../../../server/services/part-requirements-workflow";

/**
 * Une transition de demande de pièce passe par `PATCH /api/part-requirements/:id`, gardé par
 * `isInventoryManager`. Un rôle cité dans `STATUS_PERMISSIONS` hors de ce jeu serait un droit mort :
 * annoncé par la table, refusé en 403 (écart n°4 de la carte des droits, technicien qui annule).
 */
describe("demandes de pièce : table des transitions alignée sur la route", () => {
  const allowed = new Set<string>(INVENTORY_MANAGER_ROLES);

  it("chaque rôle de STATUS_PERMISSIONS peut appeler le PATCH", () => {
    const dead: string[] = [];
    for (const [from, targets] of Object.entries(STATUS_PERMISSIONS)) {
      for (const [to, roles] of Object.entries(targets ?? {})) {
        for (const role of roles ?? []) if (!allowed.has(role)) dead.push(`${from} -> ${to} : ${role}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("le technicien n'annule pas une demande en attente", () => {
    expect(STATUS_PERMISSIONS.pending.cancelled).not.toContain("technician");
  });
});
