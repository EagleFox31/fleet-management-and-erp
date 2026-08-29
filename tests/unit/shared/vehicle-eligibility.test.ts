import { describe, it, expect } from "vitest";
import {
  getMissionEligibility,
  formatEligibilityRefusal,
} from "@shared/constants/vehicle-eligibility";

const LE_15_MARS = new Date("2026-03-15T10:00:00Z");

describe("getMissionEligibility", () => {
  it("laisse partir un véhicule opérationnel et à jour", () => {
    const verdict = getMissionEligibility(
      {
        status: "operational",
        insuranceExpiry: "2026-12-31",
        technicalInspectionDate: "2026-06-30",
        licensePlateExpiry: "2027-01-15",
      },
      LE_15_MARS,
    );
    expect(verdict.eligible).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it("refuse un véhicule à l'atelier", () => {
    const verdict = getMissionEligibility({ status: "maintenance" }, LE_15_MARS);
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers[0]).toMatchObject({ code: "maintenance", kind: "mechanical" });
  });

  it("refuse une assurance expirée SANS toucher à l'état mécanique", () => {
    // Le camion roule très bien: il n'a pas le droit, ce n'est pas pareil.
    const verdict = getMissionEligibility(
      { status: "operational", insuranceExpiry: "2026-03-03" },
      LE_15_MARS,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toHaveLength(1);
    expect(verdict.blockers[0]).toMatchObject({ code: "insurance", kind: "compliance" });
    expect(verdict.blockers[0].reason).toBe("assurance expirée depuis 12 jours");
  });

  it("ne bloque pas sur une date non renseignée", () => {
    // On ne sait pas, donc on n'affirme pas: bloquer sur l'absence
    // immobiliserait toute la flotte tant que le référentiel est incomplet.
    const verdict = getMissionEligibility(
      { status: "operational", insuranceExpiry: null, technicalInspectionDate: undefined },
      LE_15_MARS,
    );
    expect(verdict.eligible).toBe(true);
  });

  it("accepte une échéance encore valable, refuse dès le jour J", () => {
    const demain = getMissionEligibility(
      { status: "operational", insuranceExpiry: "2026-03-16" },
      LE_15_MARS,
    );
    expect(demain.eligible).toBe(true);

    const aujourdhui = getMissionEligibility(
      { status: "operational", insuranceExpiry: "2026-03-15" },
      LE_15_MARS,
    );
    expect(aujourdhui.eligible).toBe(false);
    expect(aujourdhui.blockers[0].reason).toBe("assurance expire aujourd'hui");
  });

  it("cumule tous les motifs plutôt que de s'arrêter au premier", () => {
    // Régler les blocages un par un ferait perdre un aller-retour au logisticien.
    const verdict = getMissionEligibility(
      {
        status: "maintenance",
        insuranceExpiry: "2026-03-14",
        licensePlateExpiry: "2026-03-13",
      },
      LE_15_MARS,
    );
    expect(verdict.blockers.map((b) => b.code)).toEqual([
      "maintenance",
      "insurance",
      "license_plate",
    ]);
  });
});

describe("formatEligibilityRefusal", () => {
  it("nomme le véhicule et chaque motif", () => {
    const verdict = getMissionEligibility(
      { status: "out_of_service", insuranceExpiry: "2026-03-14" },
      LE_15_MARS,
    );
    expect(formatEligibilityRefusal("TN-2024-002", verdict.blockers)).toBe(
      "TN-2024-002 ne peut pas partir en mission : véhicule hors service ; assurance expirée depuis 1 jour.",
    );
  });
});
