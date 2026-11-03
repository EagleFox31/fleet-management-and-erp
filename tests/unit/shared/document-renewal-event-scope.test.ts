import { describe, expect, it } from "vitest";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { addDaysToIsoDate } from "@shared/constants/document-renewal-statuses";
import { todayUtcDateOnly, utcDateOnly } from "@shared/lib/utc-day";

describe("événements document_renewal_*", () => {
  const names = Object.keys(REALTIME_EVENTS).filter((name) => name.startsWith("document_renewal_"));

  it("le registre en déclare au moins un", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s : portée par rôles, jamais le client ni le chauffeur", (name) => {
    const scope = (REALTIME_EVENTS as Record<string, { scope: unknown }>)[name].scope as { type?: string; roles?: readonly string[] };
    expect(scope.type).toBe("roles");
    expect(scope.roles).toBeDefined();
    expect(scope.roles).not.toContain("client");
    expect(scope.roles).not.toContain("driver");
  });
});

describe("jour UTC et bornes de dates", () => {
  it("todayUtcDateOnly lit le jour UTC de l'horloge injectée", () => {
    expect(todayUtcDateOnly(new Date("2026-11-03T23:30:00Z"))).toBe("2026-11-03");
    expect(todayUtcDateOnly(new Date("2026-11-04T00:30:00Z"))).toBe("2026-11-04");
    expect(utcDateOnly(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });

  it("addDaysToIsoDate passe les fins de mois et d'année", () => {
    expect(addDaysToIsoDate("2026-11-03", 90)).toBe("2027-02-01");
    expect(addDaysToIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToIsoDate("2028-02-28", 1)).toBe("2028-02-29");
  });
});
