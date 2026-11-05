import { describe, expect, it } from "vitest";
import { canEditMissionPrice } from "../../../shared/constants/roles";
import { missionPriceBodySchema } from "../../../shared/contracts/mission-price";

describe("canEditMissionPrice", () => {
  it("avant le départ : gestionnaires de missions, sans motif", () => {
    for (const status of ["draft", "planned", "assigned"]) {
      for (const role of ["admin", "logistics", "secretary"]) {
        expect(canEditMissionPrice(role, status, false), `${role} ${status}`).toEqual({ allowed: true, reasonRequired: false });
      }
      for (const role of ["management", "technician", "driver", "client"]) {
        expect(canEditMissionPrice(role, status, false), `${role} ${status}`).toEqual({ allowed: false, blockedBy: "role" });
      }
    }
  });
  it("en cours ou livrée : admin et direction seuls, motif obligatoire", () => {
    for (const status of ["in_progress", "delivered"]) {
      for (const role of ["admin", "management"]) expect(canEditMissionPrice(role, status, false)).toEqual({ allowed: true, reasonRequired: true });
      for (const role of ["logistics", "secretary", "technician"]) expect(canEditMissionPrice(role, status, false)).toEqual({ allowed: false, blockedBy: "role" });
    }
  });
  it("terminée, annulée ou statut inconnu : figé, même pour l'admin", () => {
    for (const status of ["completed", "cancelled", "whatever"]) expect(canEditMissionPrice("admin", status, false)).toEqual({ allowed: false, blockedBy: "status" });
  });
  it("une facture non annulée fige le prix, pour tous les rôles autorisés", () => {
    expect(canEditMissionPrice("admin", "planned", true)).toEqual({ allowed: false, blockedBy: "invoice" });
    expect(canEditMissionPrice("management", "in_progress", true)).toEqual({ allowed: false, blockedBy: "invoice" });
  });
});

describe("missionPriceBodySchema", () => {
  it("entier XAF ou null ; champ inconnu, décimal, négatif, tarif sans prix refusés", () => {
    expect(missionPriceBodySchema.safeParse({ agreedPrice: 1000 }).success).toBe(true);
    expect(missionPriceBodySchema.safeParse({ agreedPrice: null }).success).toBe(true);
    expect(missionPriceBodySchema.safeParse({ agreedPrice: 1000, tariffGridId: 3, reason: "x" }).success).toBe(true);
    for (const bad of [{ agreedPrice: 10.5 }, { agreedPrice: -1 }, { agreedPrice: "10" }, {}, { agreedPrice: 1, status: "x" }, { agreedPrice: null, tariffGridId: 3 }]) {
      expect(missionPriceBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
