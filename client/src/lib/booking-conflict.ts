import { bookingConflictResponseSchema, type BookingConflict } from "@shared/contracts/work-order-booking";
import { ApiError } from "@/lib/api-error";

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Une ligne par chevauchement, avec l'OT en cause et son creneau. */
export function describeBookingConflict(conflict: BookingConflict): string {
  const subject = conflict.kind === "technician" ? "Technicien déjà affecté" : "Véhicule déjà engagé";
  const period = conflict.to
    ? `du ${formatDay(conflict.from)} au ${formatDay(conflict.to)}`
    : `depuis le ${formatDay(conflict.from)} (sans fin prévue)`;
  return `${subject} à l'OT #${conflict.workOrderId} ${period}`;
}

/**
 * Conflits d'une double affectation (409 `CONFLICT` du contrat `work-order-booking`).
 * `null` si l'erreur est autre chose : l'appelant garde `userMessageOf`.
 */
export function bookingConflictsOf(error: unknown): BookingConflict[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = bookingConflictResponseSchema.safeParse(error.body);
  return parsed.success ? parsed.data.conflicts : null;
}
