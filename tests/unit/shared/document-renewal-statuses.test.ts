import { describe, expect, it } from "vitest";
import { documentRenewalRequests } from "../../../shared/schema";
import {
  DOCUMENT_RENEWAL_REQUEST_STATUSES,
  documentRenewalTransitionRefusal,
} from "../../../shared/constants/document-renewal-statuses";

describe("transitions d'une demande de renouvellement", () => {
  it("couvre exactement l'énumération du schéma", () => {
    expect([...DOCUMENT_RENEWAL_REQUEST_STATUSES].sort()).toEqual([...documentRenewalRequests.status.enumValues].sort());
  });

  it.each([
    ["pending", "in_progress"],
    ["pending", "rejected"],
    ["in_progress", "completed"],
    ["in_progress", "rejected"],
    ["completed", "completed"],
  ] as const)("%s -> %s permis", (from, to) => {
    expect(documentRenewalTransitionRefusal(from, to)).toBeNull();
  });

  it.each([
    ["pending", "completed"],
    ["in_progress", "pending"],
    ["completed", "pending"],
    ["completed", "rejected"],
    ["rejected", "in_progress"],
  ] as const)("%s -> %s refusé avec un message", (from, to) => {
    expect(documentRenewalTransitionRefusal(from, to)).toMatch(/\S/);
  });
});

describe("isIsoCalendarDate", () => {
  it("accepte une vraie date AAAA-MM-JJ, refuse le reste", async () => {
    const { isIsoCalendarDate } = await import("../../../shared/constants/calendar-date");
    expect(isIsoCalendarDate("2027-12-31")).toBe(true);
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-30", "31/12/2027", "2027-12-31T00:00", "", 20271231, null]) {
      expect(isIsoCalendarDate(bad)).toBe(false);
    }
  });
});
