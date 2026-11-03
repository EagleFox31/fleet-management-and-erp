import { describe, expect, it } from "vitest";
import { getMissionEligibility } from "@shared/constants/vehicle-eligibility";

const vehicle = { status: "operational", insuranceExpiry: "2026-10-01", receipts: { insurance: "2026-11-03" } } as const;

describe("récépissé : jour UTC", () => {
  it("à 23:30Z le jour J, le récépissé daté du jour est valable", () => {
    expect(getMissionEligibility(vehicle, new Date("2026-11-03T23:30:00Z")).eligible).toBe(true);
  });
  it("à 00:30Z le lendemain, il ne l'est plus", () => {
    expect(getMissionEligibility(vehicle, new Date("2026-11-04T00:30:00Z")).eligible).toBe(false);
  });
});
