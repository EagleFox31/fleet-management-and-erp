import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));

import { computeCpcExpiry, cpcTrainingService } from "../../../server/services/cpc-training-service";
import { addDaysToDateOnly } from "../../../shared/constants/expiry-day";

/**
 * Expiration CPC en jour calendaire UTC. L'heure simulee (23h30 UTC) est celle ou un calcul en
 * heure locale ou en millisecondes se trompe d'un jour : le resultat ne depend ni du fuseau
 * de la machine ni de l'heure d'execution.
 */
const TODAY = "2026-11-05";

describe("service CPC : jour UTC", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T23:30:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  const ago = (n: number) => addDaysToDateOnly(TODAY, -n)!;

  it("J-731 : derniere journee valable, 0 jour restant", () => {
    expect(computeCpcExpiry(ago(731))).toEqual({ expiryDay: TODAY, daysRemaining: 0 });
  });

  it("J-732 : expiree depuis hier, -1 jour restant", () => {
    expect(computeCpcExpiry(ago(732))).toEqual({ expiryDay: ago(1), daysRemaining: -1 });
  });

  it("date absente : pas d'expiration", () => {
    expect(computeCpcExpiry(null)).toEqual({ expiryDay: null, daysRemaining: 0 });
  });

  it("statut a J-731 et J-732 : A FORMER (marge de 59 jours inchangee)", () => {
    expect(cpcTrainingService.calculateCPCStatus(ago(731))).toBe("À FORMER");
    expect(cpcTrainingService.calculateCPCStatus(ago(732))).toBe("À FORMER");
  });

  it("marge de 59 jours : expiration a J+60 FORME, J+59 A FORMER", () => {
    expect(cpcTrainingService.calculateCPCStatus(ago(731 - 60))).toBe("FORMÉ");
    expect(cpcTrainingService.calculateCPCStatus(ago(731 - 59))).toBe("À FORMER");
  });

  it("sans date : NON FORME", () => {
    expect(cpcTrainingService.calculateCPCStatus(null)).toBe("NON FORMÉ");
  });
});
