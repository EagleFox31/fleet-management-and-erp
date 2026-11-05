import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRIP_DURATION_BASIS,
  missionOperationBodySchema,
  recapStatusOf,
  tripDurationDays,
} from "../../../shared/contracts/mission-operations";

describe("recapStatusOf", () => {
  it("voyage tant que rien n'est livré ni facturé", () => {
    expect(recapStatusOf({ missionStatus: "in_progress" })).toBe("trip");
    expect(recapStatusOf({ missionStatus: "pending", invoiceStatus: null })).toBe("trip");
  });
  it("facturation : livrée ou retour saisi, sans facture", () => {
    expect(recapStatusOf({ missionStatus: "delivered" })).toBe("invoicing");
    expect(recapStatusOf({ missionStatus: "in_progress", returnDate: "2026-03-02" })).toBe("invoicing");
  });
  it("attente de paiement puis payée selon la facture liée", () => {
    for (const s of ["pending", "partial", "overdue"]) {
      expect(recapStatusOf({ missionStatus: "delivered", invoiceStatus: s })).toBe("awaiting_payment");
    }
    expect(recapStatusOf({ missionStatus: "delivered", invoiceStatus: "paid" })).toBe("paid");
  });
  it("facture annulée : retour à la facturation ; mission annulée : annulée", () => {
    expect(recapStatusOf({ missionStatus: "delivered", invoiceStatus: "cancelled" })).toBe("invoicing");
    expect(recapStatusOf({ missionStatus: "cancelled", invoiceStatus: "paid" })).toBe("cancelled");
  });
});

describe("tripDurationDays", () => {
  const op = {
    loadingDate: "2026-03-01",
    departureDate: "2026-03-02",
    unloadingDate: "2026-03-06",
    returnDate: "2026-03-09",
  };
  it("défaut : déchargement moins départ", () => {
    expect(DEFAULT_TRIP_DURATION_BASIS).toBe("departure_unloading");
    expect(tripDurationDays(op)).toBe(4);
  });
  it("base configurable", () => {
    expect(tripDurationDays(op, "loading_unloading")).toBe(5);
    expect(tripDurationDays(op, "loading_return")).toBe(8);
  });
  it("null si une date manque ou si la fin précède le début", () => {
    expect(tripDurationDays({ ...op, departureDate: null })).toBeNull();
    expect(tripDurationDays({ ...op, unloadingDate: "2026-02-01" })).toBeNull();
  });
});

describe("missionOperationBodySchema", () => {
  it("refuse un champ inconnu (strict) et une date invalide", () => {
    expect(missionOperationBodySchema.safeParse({ createdBy: 1 }).success).toBe(false);
    expect(missionOperationBodySchema.safeParse({ loadingDate: "demain" }).success).toBe(false);
    expect(missionOperationBodySchema.safeParse({ loadingDate: "2026-03-01", blNumber: null }).success).toBe(true);
  });
});
