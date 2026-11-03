import { describe, expect, it } from "vitest";
import { driverLicenseDaysLabel, getDriverLicenseStatus } from "../../../client/src/lib/driver-license-status";
import { isDriverLicenseExpiredOn } from "../../../shared/constants/expiry-day";

/**
 * #224 : le badge permis des écrans chauffeurs dit la même chose que le serveur
 * (check-list, lancement) : valable le jour J, expiré à J+1, jour UTC.
 */

const TODAY = "2026-11-03";

function offset(days: number): string {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("getDriverLicenseStatus : J-1, J, J+1", () => {
  const now = new Date(`${TODAY}T10:00:00.000Z`);

  it.each([
    [1, "soon", 1],
    [0, "soon", 0],
    [-1, "expired", null],
  ] as const)("échéance dans %i jour(s) -> %s", (days, state, remaining) => {
    expect(getDriverLicenseStatus(offset(days), now)).toEqual({ state, days: remaining });
  });

  it("même verdict « expiré » que le serveur à J-1, J, J+1", () => {
    for (const days of [1, 0, -1]) {
      const expired = getDriverLicenseStatus(offset(days), now).state === "expired";
      expect(expired).toBe(isDriverLicenseExpiredOn(offset(days), TODAY));
    }
  });

  it("jour UTC : à 23:30Z le jour J, encore valable ; à 00:00Z le lendemain, expiré", () => {
    expect(getDriverLicenseStatus(TODAY, new Date(`${TODAY}T23:30:00.000Z`)).state).toBe("soon");
    expect(getDriverLicenseStatus(TODAY, new Date(`${offset(1)}T00:00:00.000Z`)).state).toBe("expired");
  });

  it("paliers 30 et 90 jours, absent, illisible", () => {
    expect(getDriverLicenseStatus(offset(30), now).state).toBe("soon");
    expect(getDriverLicenseStatus(offset(31), now).state).toBe("warning");
    expect(getDriverLicenseStatus(offset(90), now).state).toBe("warning");
    expect(getDriverLicenseStatus(offset(91), now).state).toBe("valid");
    expect(getDriverLicenseStatus(null, now).state).toBe("none");
    expect(getDriverLicenseStatus("2026-02-30", now).state).toBe("expired");
  });

  it("libellé : « Dernier jour » le jour J", () => {
    expect(driverLicenseDaysLabel(0)).toBe("Dernier jour");
    expect(driverLicenseDaysLabel(5, " restants")).toBe("5j restants");
  });
});
