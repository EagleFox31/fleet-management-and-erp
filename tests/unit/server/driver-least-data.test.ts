import { describe, expect, it } from "vitest";
import { canReadFuelCardAmounts, omitFuelCardRunningBalance, presentFuelCardBalance, withoutFuelCardBalance } from "../../../server/lib/fuel-balance-scope";
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

describe("solde courant sur les lignes de plein", () => {
  const line = { id: 1, quantity: 40, balance: "9", fuelBalance: "8" };
  it("retire balance et fuelBalance hors lecteurs, y compris sans rôle, sur une ligne ou une liste", () => {
    for (const role of ["driver", "technician", "warehouse", "", null, undefined]) {
      expect(withoutFuelCardBalance({ role }, line)).toEqual({ id: 1, quantity: 40 });
      expect(withoutFuelCardBalance({ role }, [line, line])).toEqual([{ id: 1, quantity: 40 }, { id: 1, quantity: 40 }]);
    }
    expect(withoutFuelCardBalance(undefined, line)).toEqual({ id: 1, quantity: 40 });
  });
  it("lecteurs de la carte : inchangé ; l'entrée n'est jamais modifiée", () => {
    expect(withoutFuelCardBalance({ role: "accountant" }, line)).toBe(line);
    withoutFuelCardBalance({ role: "driver" }, line);
    expect(line.balance).toBe("9");
    expect(omitFuelCardRunningBalance(null)).toBeNull();
  });
});

describe("coordonnées client : liste blanche de rôles", () => {
  it("un rôle inconnu, vide ou client ne reçoit que id et nom", () => {
    for (const role of ["client", "unknown", "", null, undefined]) {
      expect(redactMissionClientContact({ role }, mission).client).toEqual({ id: 2, name: "X" });
    }
  });
});
