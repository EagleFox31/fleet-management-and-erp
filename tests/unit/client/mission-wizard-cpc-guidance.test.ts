import { describe, expect, it } from "vitest";
import { CPC_UPDATE_REQUESTEE, getCpcBlockGuidance } from "@/lib/mission-wizard-rules";
import { ALL_APP_ROLES, canManageDrivers, DRIVER_MANAGER_ROLES } from "@shared/constants/roles";

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

  it("rôles autorisés : ouvrir la fiche du chauffeur, plus le tableau de bord du secrétariat", () => {
    for (const role of DRIVER_MANAGER_ROLES) {
      const g = getCpcBlockGuidance({ ...nonForme, id: 42 }, role);
      expect(g?.action).toContain("ouvrez la fiche du chauffeur");
      expect(g?.action).not.toContain("tableau de bord");
      expect(g?.driverHref).toBe("/drivers/42");
    }
  });

  it("rôle autorisé sans identifiant : texte seul, pas de lien", () => {
    expect(getCpcBlockGuidance(nonForme, "admin")?.driverHref).toBeNull();
  });

  it("rôles refusés : demander à admin, logistique ou secrétariat, sans lien", () => {
    for (const role of ["management", "workshop_manager", "driver", "client", undefined]) {
      const g = getCpcBlockGuidance({ ...nonForme, id: 42 }, role);
      expect(g?.action).toContain("demandez à l'administrateur, à la logistique ou au secrétariat");
      expect(g?.action).toContain("depuis la fiche du chauffeur");
      expect(g?.driverHref).toBeNull();
    }
  });

  it("la liste de rôles du message et le lien suivent canManageDrivers / DRIVER_MANAGER_ROLES", () => {
    expect(CPC_UPDATE_REQUESTEE.split(/, | ou /)).toHaveLength(DRIVER_MANAGER_ROLES.length);
    for (const role of ALL_APP_ROLES) {
      const g = getCpcBlockGuidance({ ...nonForme, id: 1 }, role);
      expect(g?.canEditDriver).toBe(canManageDrivers(role));
      expect(g?.driverHref !== null).toBe(canManageDrivers(role));
    }
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
