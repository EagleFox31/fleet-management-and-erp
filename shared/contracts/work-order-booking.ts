/**
 * Double affectation (P-08) : un technicien ou un véhicule ne peut pas être
 * sur deux ordres de travail actifs au même moment.
 *
 * Refus : 409 `CONFLICT` avec un message métier explicite et un
 * `BookingConflict` par chevauchement dans `errors`.
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common";

/** Statuts d'OT qui occupent un créneau. */
export const BOOKING_ACTIVE_STATUSES = ["pending", "in_progress", "awaiting_parts"] as const;

export const bookingConflictSchema = z.object({
  kind: z.enum(["technician", "vehicle"]),
  workOrderId: z.number().int(),
  from: isoDateTimeSchema,
  to: isoDateTimeSchema.nullable(),
});

export const bookingConflictResponseSchema = z.object({
  message: z.string(),
  code: z.literal("CONFLICT"),
  requestId: z.string().optional(),
  conflicts: z.array(bookingConflictSchema).min(1),
});

export type BookingConflict = z.infer<typeof bookingConflictSchema>;
export type BookingConflictResponse = z.infer<typeof bookingConflictResponseSchema>;

/** Deux créneaux se chevauchent ; une fin absente signifie « ouvert ». */
export function bookingsOverlap(
  a: { from: Date; to: Date | null },
  b: { from: Date; to: Date | null },
): boolean {
  const aEnd = a.to?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.to?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.from.getTime() < bEnd && b.from.getTime() < aEnd;
}
