import { describe, expect, it } from "vitest";
import { driverCpcStatusOf, getStepBlockReason, type WizardStepInput } from "@/lib/mission-wizard-rules";

const base: WizardStepInput = {
  step: 3,
  clientId: "1",
  orderNumber: "BL-1",
  pickupAddress: "A",
  deliveryAddress: "B",
  vehicleId: "",
  driverId: "7",
  weightCompatible: true,
  cargoWeight: "",
  vehicleTonnage: null,
  selectedDriver: null,
};

describe("règles de l'assistant de création de mission", () => {
  it("CPC valide : l'étape 3 n'est pas bloquée", () => {
    expect(getStepBlockReason({ ...base, selectedDriver: { cpcStatus: "FORMÉ", cpcStatusRecorded: "FORMÉ" } })).toBeNull();
  });

  it("CPC expiré : l'étape 3 est bloquée avec une raison", () => {
    const r = getStepBlockReason({ ...base, selectedDriver: { cpcStatus: "À FORMER", cpcStatusRecorded: "À FORMER" } });
    expect(r).toContain("Chauffeur non éligible");
  });

  it("date absente mais statut enregistré valide : pas de blocage (défaut corrigé)", () => {
    const driver = { cpcStatus: "NON FORMÉ", cpcStatusRecorded: "FORMÉ" };
    expect(driverCpcStatusOf(driver)).toBe("FORMÉ");
    expect(getStepBlockReason({ ...base, selectedDriver: driver })).toBeNull();
  });

  it("statut FORMÉ mais formation expirée : l'étape 3 est bloquée avec la date", () => {
    const r = getStepBlockReason({
      ...base,
      selectedDriver: { cpcStatus: "FORMÉ", cpcStatusRecorded: "FORMÉ", cpcTrainingDate: "2020-01-01" },
    });
    expect(r).toContain("Formation CPC expirée le 01/01/2022");
  });

  it("ancienne réponse sans statut enregistré : retombe sur le statut d'affichage", () => {
    expect(driverCpcStatusOf({ cpcStatus: "FORMÉ" })).toBe("FORMÉ");
  });

  it("explique les blocages des étapes 1, 2 et du poids", () => {
    expect(getStepBlockReason({ ...base, step: 1, clientId: "" })).toContain("client");
    expect(getStepBlockReason({ ...base, step: 2, deliveryAddress: " " })).toContain("livraison");
    expect(
      getStepBlockReason({ ...base, vehicleId: "3", weightCompatible: false, cargoWeight: "30", vehicleTonnage: 10, selectedDriver: { cpcStatusRecorded: "FORMÉ" } }),
    ).toContain("dépasse");
  });
});
