import { describe, expect, it } from "vitest";
import {
  BookingConflictError,
  bookingGuard,
  findBookingConflicts,
  type ExistingBooking,
} from "../../../server/services/work-order-booking";
import { bookingConflictResponseSchema } from "@shared/contracts/work-order-booking";

const d = (h: number) => new Date(Date.UTC(2026, 10, 2, h));
const ot = (id: number, from: number | null, to: number | null, over: Partial<ExistingBooking> = {}): ExistingBooking => ({
  id,
  technicianId: 1,
  vehicleId: 10,
  status: "in_progress",
  from: from === null ? null : d(from),
  to: to === null ? null : d(to),
  ...over,
});

describe("findBookingConflicts", () => {
  it("détecte un chevauchement sur le technicien", () => {
    const r = findBookingConflicts({ technicianId: 1, vehicleId: 99, from: d(9), to: d(12) }, [ot(5, 8, 10)]);
    expect(r).toEqual([{ kind: "technician", workOrderId: 5, from: d(8).toISOString(), to: d(10).toISOString() }]);
  });
  it("détecte le véhicule et le technicien ensemble", () => {
    const r = findBookingConflicts({ technicianId: 1, vehicleId: 10, from: d(9), to: d(12) }, [ot(5, 8, 10)]);
    expect(r.map((c) => c.kind).sort()).toEqual(["technician", "vehicle"]);
  });
  it("bornes qui se touchent : pas de conflit (semi-ouvert)", () => {
    expect(findBookingConflicts({ technicianId: 1, from: d(10), to: d(12) }, [ot(5, 8, 10)])).toEqual([]);
    expect(findBookingConflicts({ technicianId: 1, from: d(6), to: d(8) }, [ot(5, 8, 10)])).toEqual([]);
  });
  it("un OT existant ouvert (sans fin) occupe tout le futur", () => {
    const r = findBookingConflicts({ technicianId: 1, from: d(20), to: d(22) }, [ot(5, 8, null)]);
    expect(r).toHaveLength(1);
    expect(r[0].to).toBeNull();
  });
  it("un candidat ouvert chevauche tout OT qui se termine après son début", () => {
    expect(findBookingConflicts({ technicianId: 1, from: d(9), to: null }, [ot(5, 20, 22)])).toHaveLength(1);
    expect(findBookingConflicts({ technicianId: 1, from: d(23), to: null }, [ot(5, 20, 22)])).toEqual([]);
  });
  it("s'exclut lui-même à la modification", () => {
    expect(findBookingConflicts({ id: 5, technicianId: 1, from: d(8), to: d(10) }, [ot(5, 8, 10)])).toEqual([]);
  });
  it("ignore les OT terminés, annulés ou sans début", () => {
    const others = [ot(1, 8, 10, { status: "completed" }), ot(2, 8, 10, { status: "cancelled" }), ot(3, null, null)];
    expect(findBookingConflicts({ technicianId: 1, vehicleId: 10, from: d(9), to: d(11) }, others)).toEqual([]);
  });
  it("retient awaiting_parts et pending", () => {
    const others = [ot(1, 8, 10, { status: "awaiting_parts" }), ot(2, 8, 10, { status: "pending" })];
    expect(findBookingConflicts({ technicianId: 1, from: d(9), to: d(11) }, others)).toHaveLength(2);
  });
  it("ressource absente : pas de faux conflit", () => {
    const other = ot(1, 8, 10, { technicianId: null, vehicleId: null });
    expect(findBookingConflicts({ technicianId: null, vehicleId: null, from: d(9), to: d(11) }, [other])).toEqual([]);
  });
  it("sans début, aucun créneau à contrôler", () => {
    expect(findBookingConflicts({ technicianId: 1, from: null }, [ot(1, 8, 10)])).toEqual([]);
  });
});

describe("bookingGuard", () => {
  it("lève un 409 conforme au contrat", async () => {
    const load = async () => [ot(5, 8, 10)];
    const err = await bookingGuard({ technicianId: 1, from: d(9), to: d(11) }, { load, executor: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingConflictError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
    const body = bookingConflictResponseSchema.parse({
      message: err.message,
      code: err.code,
      conflicts: err.details.conflicts,
    });
    expect(body.conflicts).toHaveLength(1);
  });
  it("ne lève rien sans conflit", async () => {
    await expect(
      bookingGuard({ technicianId: 1, from: d(12), to: d(14) }, { load: async () => [ot(5, 8, 10)], executor: {} }),
    ).resolves.toBeUndefined();
  });
});
