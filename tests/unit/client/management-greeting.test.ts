import { describe, it, expect } from "vitest";
import {
  extractFormalLastName,
  formatManagementGreeting,
  resolveDayPeriodGreeting,
} from "@/lib/management-greeting";

describe("resolveDayPeriodGreeting", () => {
  it("retourne Bonjour le matin", () => {
    expect(resolveDayPeriodGreeting(new Date(2026, 7, 29, 8, 0))).toBe("Bonjour");
  });

  it("retourne Bon après-midi entre midi et 18 h", () => {
    expect(resolveDayPeriodGreeting(new Date(2026, 7, 29, 14, 0))).toBe("Bon après-midi");
  });

  it("retourne Bonsoir le soir et la nuit", () => {
    expect(resolveDayPeriodGreeting(new Date(2026, 7, 29, 20, 0))).toBe("Bonsoir");
    expect(resolveDayPeriodGreeting(new Date(2026, 7, 29, 2, 0))).toBe("Bonsoir");
  });
});

describe("extractFormalLastName", () => {
  it("extrait le nom de famille", () => {
    expect(extractFormalLastName("Jean Dupont")).toBe("Dupont");
    expect(extractFormalLastName("Jean-Pierre Martin")).toBe("Martin");
  });
});

describe("formatManagementGreeting", () => {
  it("formate une salutation formelle avec l'heure", () => {
    expect(formatManagementGreeting("Jean Dupont", new Date(2026, 7, 29, 9, 0))).toBe(
      "Bonjour M. Dupont",
    );
    expect(formatManagementGreeting("Jean Dupont", new Date(2026, 7, 29, 15, 0))).toBe(
      "Bon après-midi M. Dupont",
    );
    expect(formatManagementGreeting("Jean Dupont", new Date(2026, 7, 29, 21, 0))).toBe(
      "Bonsoir M. Dupont",
    );
  });
});
