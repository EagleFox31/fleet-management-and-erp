import { afterEach, describe, expect, it, vi } from "vitest";
import { maintenancePriorityOf } from "../../../server/lib/maintenance-priority";
import { maintenanceService } from "../../../client/src/services/maintenanceService";

/**
 * #342 : priorité d'une échéance (serveur) et durée de réalisation (client) en jours
 * calendaires UTC, identiques quel que soit le fuseau du processus.
 */
const ORIGINAL_TZ = process.env.TZ;
const ZONES = ["UTC", "Africa/Douala", "America/New_York", "Pacific/Kiritimati"];
const NOW = new Date("2026-03-30T23:30:00Z");

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
});

function byZone<T>(fn: () => T): T[] {
  return ZONES.map((tz) => {
    process.env.TZ = tz;
    return fn();
  });
}

describe("priorité d'échéance : jour UTC", () => {
  it.each([
    ["2026-04-06", "high"], // J+7
    ["2026-04-07", "medium"], // J+8
    ["2026-04-13", "medium"], // J+14
    ["2026-04-14", "low"], // J+15
    ["2026-03-30", "high"], // jour J
    ["2026-03-01", "high"], // en retard
  ])("échéance %s à 23h30 UTC : %s dans tous les fuseaux", (due, expected) => {
    expect(new Set(byZone(() => maintenancePriorityOf(due, NOW)))).toEqual(new Set([expected]));
  });

  it("échéance absente : haute, comme avant", () => {
    expect(new Set(byZone(() => maintenancePriorityOf(null, NOW)))).toEqual(new Set(["high"]));
  });

  it("échéance Date avec heure : le jour UTC décide, pas l'écart en millisecondes", () => {
    // 6 avril 23h45 UTC = J+7 (haute) ; l'écart en ms (7 j 15 min) arrondi au supérieur donnait J+8 (moyenne).
    expect(new Set(byZone(() => maintenancePriorityOf(new Date("2026-04-06T23:45:00Z"), NOW)))).toEqual(new Set(["high"]));
  });

  it("accepte une Date", () => {
    expect(new Set(byZone(() => maintenancePriorityOf(new Date("2026-04-07T00:00:00Z"), NOW)))).toEqual(new Set(["medium"]));
  });
});

describe("durée de réalisation : jours calendaires UTC", () => {
  it("même nombre de jours dans tous les fuseaux, à 23h30 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const r = byZone(() => maintenanceService.calculateCompletionTime("2026-03-28", "2026-03-30T23:30:00Z"));
    expect(new Set(r)).toEqual(new Set([2]));
  });

  it("valeur absolue : réalisation avant la date prévue", () => {
    expect(maintenanceService.calculateCompletionTime("2026-03-30", "2026-03-28T01:00:00Z")).toBe(2);
  });
});
