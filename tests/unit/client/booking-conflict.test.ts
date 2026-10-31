import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { bookingConflictsOf, describeBookingConflict } from "@/lib/booking-conflict";

const conflict = { kind: "technician" as const, workOrderId: 41, from: "2026-10-05T08:00:00.000Z", to: "2026-10-09T17:00:00.000Z" };
const body = { message: "Technicien déjà affecté", code: "CONFLICT", conflicts: [conflict] };

describe("conflits de double affectation", () => {
  it("un 409 du contrat donne la liste des conflits", () => {
    expect(bookingConflictsOf(new ApiError(409, "x", body))).toEqual([conflict]);
  });

  it("un 409 sans conflits, un autre statut ou une autre erreur donnent null", () => {
    expect(bookingConflictsOf(new ApiError(409, "x", { message: "x", code: "CONFLICT" }))).toBeNull();
    expect(bookingConflictsOf(new ApiError(500, "x", body))).toBeNull();
    expect(bookingConflictsOf(new Error("boom"))).toBeNull();
  });

  it("decrit le technicien et l'OT en cause avec la periode", () => {
    const line = describeBookingConflict(conflict);
    expect(line).toContain("Technicien déjà affecté à l'OT #41");
    expect(line).toMatch(/du \d{2}\/\d{2}\/2026 au \d{2}\/\d{2}\/2026/);
  });

  it("un creneau ouvert et un vehicule sont decrits", () => {
    const line = describeBookingConflict({ kind: "vehicle", workOrderId: 7, from: conflict.from, to: null });
    expect(line).toContain("Véhicule déjà engagé à l'OT #7 depuis le");
  });
});
