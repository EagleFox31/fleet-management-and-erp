import { describe, expect, it } from "vitest";
import { canReadFuelCardAmounts, presentFuelCardBalance } from "../../../server/lib/fuel-balance-scope";
import { redactMissionClientContact } from "../../../server/lib/mission-client-contact-scope";

const balance = { balance: 5, totalCredits: 9, priceSource: "real", averagePricePerLiter: 800, extra: 1 };
const mission = { id: 1, client: { id: 2, name: "X", email: "a@b", phone: "1", contactPerson: "Y" } };

describe("solde carte carburant", () => {
  it("liste blanche pour les rôles sans lecture, échec fermé sans rôle", () => {
    for (const role of ["driver", "technician", "", null, undefined]) {
      expect(presentFuelCardBalance({ role }, balance)).toEqual({ priceSource: "real", averagePricePerLiter: 800 });
    }
    expect(presentFuelCardBalance(undefined, balance)).toEqual({ priceSource: "real", averagePricePerLiter: 800 });
  });
  it("lecteurs de la carte", () => {
    for (const role of ["admin", "logistics", "secretary", "accountant", "management"]) {
      expect(canReadFuelCardAmounts(role)).toBe(true);
      expect(presentFuelCardBalance({ role }, balance)).toBe(balance);
    }
  });
});

describe("coordonnées du client d'une mission", () => {
  it("le chauffeur ne garde que id et nom", () => {
    expect(redactMissionClientContact({ role: "driver" }, mission).client).toEqual({ id: 2, name: "X" });
  });
  it("le personnel et une mission sans client sont inchangés", () => {
    expect(redactMissionClientContact({ role: "logistics" }, mission)).toBe(mission);
    const none = { id: 1, client: null };
    expect(redactMissionClientContact({ role: "driver" }, none)).toBe(none);
  });
});
