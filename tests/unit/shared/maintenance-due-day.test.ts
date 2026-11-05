import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maintenanceDaysUntil, nextMaintenanceDueDateOnly } from "../../../shared/constants/maintenance-due-day";
import { getMaintenanceScheduleStatus } from "../../../client/src/lib/maintenance-schedule-status";

/**
 * #342 : l'échéance d'un plan d'entretien se juge au jour UTC, quel que soit le fuseau du
 * navigateur. L'ancien calcul (période ajoutée par `setDate` / `setMonth` à l'heure locale, écart
 * en ms avec l'instant, `Math.ceil`) dépendait du fuseau. Rejoué ici, il échoue sur :
 * - « le résultat ne dépend pas du fuseau » (2, 1 ou -2 jours selon la zone) : le vrai rouge ;
 * - « changement d'heure » : 1 au lieu de 0 le jour J (la période locale glisse d'une heure) ;
 * - « lendemain du changement d'heure » : `-0` (« À venir ») au lieu de -1 (« En retard ») ;
 * - « fin de mois » (débordement 3 mars au lieu du plafond 28 février, aligné sur le serveur).
 * Le cas « jour J à 23h30 » rend `-0` avec l'ancien calcul, `0` avec le nouveau : l'assertion
 * normalise par `+ 0` (`toEqual(0)` rejette `-0`), ce cas n'est donc pas compté comme un rouge.
 */
const ORIGINAL_TZ = process.env.TZ;

describe("échéance d'entretien : jour UTC", () => {
  beforeEach(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("ajoute la période en jours calendaires, mois et années compris", () => {
    expect(nextMaintenanceDueDateOnly("2026-10-24", "daily", 1)).toBe("2026-10-25");
    expect(nextMaintenanceDueDateOnly("2026-10-24", "weekly", 2)).toBe("2026-11-07");
    expect(nextMaintenanceDueDateOnly("2026-08-15", "quarterly", 1)).toBe("2026-11-15");
    expect(nextMaintenanceDueDateOnly("2026-08-15", "yearly", 2)).toBe("2028-08-15");
    expect(nextMaintenanceDueDateOnly("2026-10-24", "mileage", 5000)).toBeNull();
    expect(nextMaintenanceDueDateOnly(null, "daily", 1)).toBeNull();
  });

  it("fin de mois : plafonné au dernier jour du mois cible, comme le serveur (addMonthsUtc)", () => {
    expect(nextMaintenanceDueDateOnly("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(nextMaintenanceDueDateOnly("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(nextMaintenanceDueDateOnly("2026-03-31", "quarterly", 1)).toBe("2026-06-30");
    expect(nextMaintenanceDueDateOnly("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(nextMaintenanceDueDateOnly("2026-10-31", "monthly", 4)).toBe("2027-02-28");
  });

  it("période en jours qui traverse le changement d'heure (25 octobre 2026) : jour J à 00:30 UTC", () => {
    // Échéance le 26 ; l'ancien calcul, en heure locale, la plaçait à 01:00 UTC.
    const schedule = { isActive: true, scheduledDate: "2026-10-24", frequency: "daily", frequencyValue: 2 };
    // Le 26 à 00:30 UTC (01:30 à Paris) : jour J. L'ancien calcul rendait 1.
    const dueDay = new Date("2026-10-26T00:30:00Z");
    expect(maintenanceDaysUntil(schedule, dueDay)).toBe(0);
    expect(getMaintenanceScheduleStatus(schedule, dueDay).label).toBe("À venir");
  });

  it("lendemain du changement d'heure, 27 octobre 00:30 UTC : « En retard », pas « À venir »", () => {
    // L'ancien calcul rendait -0 ici : `-0 < 0` est faux, le badge restait « À venir ».
    const schedule = { isActive: true, scheduledDate: "2026-10-24", frequency: "daily", frequencyValue: 2 };
    const nextDay = new Date("2026-10-27T00:30:00Z");
    expect(maintenanceDaysUntil(schedule, nextDay)).toBe(-1);
    expect(getMaintenanceScheduleStatus(schedule, nextDay).label).toBe("En retard");
  });

  it("jour J jusqu'à 23h30 UTC, en retard à minuit UTC", () => {
    const schedule = { isActive: true, scheduledDate: "2026-11-04", frequency: "daily", frequencyValue: 1 };
    expect(maintenanceDaysUntil(schedule, new Date("2026-11-05T23:30:00Z"))! + 0).toBe(0);
    expect(getMaintenanceScheduleStatus(schedule, new Date("2026-11-05T23:30:00Z")).label).toBe("À venir");
    expect(maintenanceDaysUntil(schedule, new Date("2026-11-06T00:00:00Z"))).toBe(-1);
  });

  it("le résultat ne dépend pas du fuseau du navigateur", () => {
    const schedule = { isActive: true, scheduledDate: "2026-03-01", frequency: "monthly", frequencyValue: 1 };
    const now = new Date("2026-03-30T23:30:00Z");
    const byZone = ["UTC", "Africa/Douala", "America/New_York", "Pacific/Kiritimati", "Europe/Paris"].map((tz) => {
      process.env.TZ = tz;
      return maintenanceDaysUntil(schedule, now);
    });
    expect(new Set(byZone)).toEqual(new Set([2]));
  });

  it("statuts inchangés hors date : inactif, kilométrage", () => {
    expect(getMaintenanceScheduleStatus({ isActive: false, scheduledDate: "2026-11-01", frequency: "daily", frequencyValue: 1 }).label).toBe("Inactive");
    expect(getMaintenanceScheduleStatus({ isActive: true, scheduledDate: "2026-11-01", frequency: "mileage", frequencyValue: 5000 }).label).toBe("À vérifier");
    expect(getMaintenanceScheduleStatus({ isActive: true, scheduledDate: null, frequency: "daily", frequencyValue: 1 }).label).toBe("À vérifier");
  });
});
