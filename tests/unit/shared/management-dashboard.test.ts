import { describe, it, expect } from "vitest";
import {
  resolveManagementPeriodStart,
  resolvePreviousPeriodRange,
  toIsoDateOnly,
  extractCargoLabel,
  computeTrendPercent,
  resolveTrendDirection,
} from "@shared/constants/management-dashboard";

describe("resolveManagementPeriodStart", () => {
  const reference = new Date("2026-08-15T12:00:00.000Z");

  it("retourne le premier jour du mois courant", () => {
    const start = resolveManagementPeriodStart("month", reference);
    expect(toIsoDateOnly(start)).toBe("2026-08-01");
  });

  it("retourne le premier jour de l'année courante", () => {
    const start = resolveManagementPeriodStart("year", reference);
    expect(toIsoDateOnly(start)).toBe("2026-01-01");
  });

  it("retourne une fenêtre glissante de 7 jours", () => {
    const start = resolveManagementPeriodStart("week", reference);
    expect(start.getTime()).toBeLessThan(reference.getTime());
    const diffDays = Math.round((reference.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(7);
  });
});

describe("resolvePreviousPeriodRange", () => {
  const reference = new Date(2026, 7, 15); // 15 août 2026 local

  it("retourne le mois précédent complet", () => {
    const { start, end } = resolvePreviousPeriodRange("month", reference);
    expect(toIsoDateOnly(start)).toBe("2026-07-01");
    expect(toIsoDateOnly(end)).toBe("2026-07-31");
  });

  it("retourne l'année précédente complète", () => {
    const { start, end } = resolvePreviousPeriodRange("year", reference);
    expect(toIsoDateOnly(start)).toBe("2025-01-01");
    expect(toIsoDateOnly(end)).toBe("2025-12-31");
  });
});

describe("extractCargoLabel", () => {
  it("retourne Non renseigné pour null ou vide", () => {
    expect(extractCargoLabel(null)).toBe("Non renseigné");
    expect(extractCargoLabel("")).toBe("Non renseigné");
    expect(extractCargoLabel("   ")).toBe("Non renseigné");
  });

  it("retourne une chaîne directe", () => {
    expect(extractCargoLabel("Ciment")).toBe("Ciment");
  });

  it("extrait description ou type depuis un objet jsonb", () => {
    expect(extractCargoLabel({ description: "  Gravier  " })).toBe("Gravier");
    expect(extractCargoLabel({ type: "Conteneur" })).toBe("Conteneur");
    expect(extractCargoLabel({ foo: "bar" })).toBe("Non renseigné");
  });
});

describe("computeTrendPercent", () => {
  it("calcule la variation en pourcentage", () => {
    expect(computeTrendPercent(120, 100)).toBe(20);
    expect(computeTrendPercent(80, 100)).toBe(-20);
  });

  it("retourne null si la base est nulle et la valeur courante non nulle", () => {
    expect(computeTrendPercent(100, 0)).toBeNull();
  });

  it("retourne 0 si les deux valeurs sont nulles", () => {
    expect(computeTrendPercent(0, 0)).toBe(0);
  });
});

describe("resolveTrendDirection", () => {
  it("interprète up/down/flat selon higherIsBetter", () => {
    expect(resolveTrendDirection(10)).toBe("up");
    expect(resolveTrendDirection(-10)).toBe("down");
    expect(resolveTrendDirection(0)).toBe("flat");
    expect(resolveTrendDirection(null)).toBe("flat");
    expect(resolveTrendDirection(-10, false)).toBe("up");
    expect(resolveTrendDirection(10, false)).toBe("down");
  });
});

describe("toIsoDateOnly", () => {
  it("formate une date ISO sans heure", () => {
    expect(toIsoDateOnly(new Date("2026-03-04T15:30:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
