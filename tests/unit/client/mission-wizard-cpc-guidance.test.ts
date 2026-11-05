import { describe, expect, it } from "vitest";
import { getCpcBlockGuidance } from "@/lib/mission-wizard-rules";
import { DRIVER_MANAGER_ROLES } from "@shared/constants/roles";

const nonForme = { cpcStatus: "NON FORMÉ", cpcStatusRecorded: "NON FORMÉ" };

describe("explication du blocage CPC (étape 3)", () => {
  it("chauffeur éligible ou absent : aucun message", () => {
    expect(getCpcBlockGuidance(null, "admin")).toBeNull();
    expect(getCpcBlockGuidance({ cpcStatusRecorded: "FORMÉ" }, "admin")).toBeNull();
  });

  it("date absente mais statut enregistré FORMÉ : pas de message (cohérent avec la garde)", () => {
    expect(getCpcBlockGuidance({ cpcStatus: "NON FORMÉ", cpcStatusRecorded: "FORMÉ" }, "logistics")).toBeNull();
  });

  it("NON FORMÉ : dit pourquoi ; les rôles autorisés gardent canEditDriver", () => {
    for (const role of DRIVER_MANAGER_ROLES) {
      const g = getCpcBlockGuidance(nonForme, role);
      expect(g?.why).toContain("pas à jour de sa formation CPC");
      expect(g?.canEditDriver).toBe(true);
      expect(g?.action).toContain("Mise à jour des certifications CPC");
    }
  });

  it("secrétariat : suit le formulaire depuis son tableau de bord", () => {
    const g = getCpcBlockGuidance(nonForme, "secretary");
    expect(g?.action).toContain("enregistrez la nouvelle date de formation CPC depuis votre tableau de bord");
  });

  it("admin et logistique n'ont pas le formulaire : consigne suivable, renvoi au secrétariat", () => {
    for (const role of ["admin", "logistics"]) {
      const g = getCpcBlockGuidance(nonForme, role);
      expect(g?.action).toContain("demandez au secrétariat");
      expect(g?.action).not.toContain("votre tableau de bord");
    }
  });

  it("autres rôles : renvoie vers le secrétariat, sans action de correction", () => {
    const g = getCpcBlockGuidance(nonForme, "workshop_manager");
    expect(g?.canEditDriver).toBe(false);
    expect(g?.action).toContain("demandez au secrétariat");
    expect(getCpcBlockGuidance(nonForme, undefined)?.canEditDriver).toBe(false);
  });

  it("formation expirée et date future ont chacune leur explication", () => {
    const exp = getCpcBlockGuidance({ cpcStatusRecorded: "FORMÉ", cpcTrainingDate: "2020-01-01" }, "admin");
    expect(exp?.why).toContain("expiré");
    const fut = getCpcBlockGuidance({ cpcStatusRecorded: "FORMÉ", cpcTrainingDate: "2999-01-01" }, "admin");
    expect(fut?.why).toContain("postérieure");
  });

  it("le client lit DRIVER_MANAGER_ROLES, comme isDriverManager côté serveur", () => {
    for (const role of ["management", "workshop_manager", "driver", "client"]) {
      expect(getCpcBlockGuidance(nonForme, role)?.canEditDriver).toBe(false);
    }
  });

  it("statut non renseigné", () => {
    expect(getCpcBlockGuidance({ cpcStatusRecorded: null }, "admin")?.why).toContain("n'est pas renseigné");
  });
});
