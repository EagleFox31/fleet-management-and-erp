import { describe, expect, it } from "vitest";
import { getMissionEligibility } from "@shared/constants/vehicle-eligibility";

// Horloge injectée en UTC : indépendant du fuseau de la machine.
const jour = (d: number) => new Date(Date.UTC(2026, 10, d, 12, 0, 0));
const base = { status: "operational", insuranceExpiry: "2026-10-01" } as const;

describe("récépissé dans l'éligibilité (règle unique)", () => {
  it("sans récépissé, le papier échu bloque", () => {
    expect(getMissionEligibility(base, jour(3)).eligible).toBe(false);
  });
  it("récépissé valide : éligible, y compris le jour de sa date", () => {
    expect(getMissionEligibility({ ...base, receipts: { insurance: "2026-11-03" } }, jour(3)).eligible).toBe(true);
    expect(getMissionEligibility({ ...base, receipts: { insurance: "2026-11-10" } }, jour(3)).eligible).toBe(true);
  });
  it("le lendemain de la date : de nouveau bloqué", () => {
    expect(getMissionEligibility({ ...base, receipts: { insurance: "2026-11-03" } }, jour(4)).eligible).toBe(false);
  });
  it("le récépissé d'un autre papier ne lève pas ce blocage", () => {
    expect(getMissionEligibility({ ...base, receipts: { technical_inspection: "2026-11-30" } }, jour(3)).eligible).toBe(false);
  });
  it("une date de récépissé nulle ou illisible ne lève rien", () => {
    expect(getMissionEligibility({ ...base, receipts: { insurance: null } }, jour(3)).eligible).toBe(false);
    expect(getMissionEligibility({ ...base, receipts: { insurance: "n'importe quoi" } }, jour(3)).eligible).toBe(false);
  });
});
