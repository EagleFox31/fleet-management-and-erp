/**
 * Double affectation (P-08, T-23a).
 *
 * Un technicien ou un véhicule ne peut pas être sur deux OT actifs qui se
 * chevauchent. Intervalles semi-ouverts `[from, to)` : deux OT qui se touchent
 * (fin = début) ne sont pas en conflit ; une fin absente signifie « ouvert ».
 *
 * Ce module ne monte aucune route : le branchement (POST/PATCH des OT) est T-23b.
 *   await bookingGuard({ id, technicianId, vehicleId, from, to })   // lève 409 si conflit
 */
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { workOrders } from "@shared/schema";
import {
  BOOKING_ACTIVE_STATUSES,
  bookingsOverlap,
  type BookingConflict,
} from "@shared/contracts/work-order-booking";
import { AppError } from "../lib/app-error";

export interface BookingCandidate {
  /** Absent à la création ; présent à la modification (exclusion de soi). */
  id?: number | null;
  technicianId?: number | null;
  vehicleId?: number | null;
  /** Début du créneau ; sans début, l'OT n'occupe aucun créneau. */
  from?: Date | null;
  /** Fin du créneau ; null = ouvert. */
  to?: Date | null;
}

export interface ExistingBooking {
  id: number;
  technicianId: number | null;
  vehicleId: number | null;
  status: string;
  from: Date | null;
  to: Date | null;
}

const ACTIVE = new Set<string>(BOOKING_ACTIVE_STATUSES);

/** Règle pure : aucun accès base. Un conflit par (OT, ressource) en chevauchement. */
export function findBookingConflicts(
  candidate: BookingCandidate,
  existing: readonly ExistingBooking[],
): BookingConflict[] {
  if (!candidate.from) return [];
  const slot = { from: candidate.from, to: candidate.to ?? null };
  const conflicts: BookingConflict[] = [];

  for (const other of existing) {
    if (candidate.id != null && other.id === candidate.id) continue;
    if (!ACTIVE.has(other.status) || !other.from) continue;
    if (!bookingsOverlap(slot, { from: other.from, to: other.to })) continue;

    const base = { workOrderId: other.id, from: other.from.toISOString(), to: other.to?.toISOString() ?? null };
    if (candidate.technicianId != null && other.technicianId === candidate.technicianId) {
      conflicts.push({ kind: "technician", ...base });
    }
    if (candidate.vehicleId != null && other.vehicleId === candidate.vehicleId) {
      conflicts.push({ kind: "vehicle", ...base });
    }
  }
  return conflicts;
}

/** Lecture des OT actifs du technicien ou du véhicule (filtrés en base). */
export async function loadActiveOrders(
  // db ou transaction Drizzle
  executor: any,
  technicianId: number | null | undefined,
  vehicleId: number | null | undefined,
): Promise<ExistingBooking[]> {
  const resources = [
    technicianId != null ? eq(workOrders.technicianId, technicianId) : undefined,
    vehicleId != null ? eq(workOrders.vehicleId, vehicleId) : undefined,
  ].filter((c) => c !== undefined);
  if (resources.length === 0) return [];

  const rows = await executor
    .select({
      id: workOrders.id,
      technicianId: workOrders.technicianId,
      vehicleId: workOrders.vehicleId,
      status: workOrders.status,
      from: workOrders.startDate,
      to: workOrders.endDate,
    })
    .from(workOrders)
    .where(
      and(
        inArray(workOrders.status, [...BOOKING_ACTIVE_STATUSES]),
        isNotNull(workOrders.startDate),
        or(...resources),
      ),
    );
  return rows as ExistingBooking[];
}

export function bookingConflictMessage(conflicts: readonly BookingConflict[]): string {
  const tech = conflicts.some((c) => c.kind === "technician");
  const veh = conflicts.some((c) => c.kind === "vehicle");
  const who =
    tech && veh
      ? "Le technicien et le véhicule sont déjà affectés"
      : tech
        ? "Le technicien est déjà affecté"
        : "Le véhicule est déjà affecté";
  const ids = [...new Set(conflicts.map((c) => `#${c.workOrderId}`))].join(", ");
  return `${who} sur ce créneau (ordre de travail ${ids}).`;
}

/** 409 `CONFLICT` portant `conflicts` (contrat `bookingConflictResponseSchema`). */
export class BookingConflictError extends AppError {
  readonly conflicts: BookingConflict[];
  /**
   * Même clé que `AppError.details` (T-08) : le gestionnaire central doit la
   * fusionner dans la réponse. Tant que T-08 n'est pas poussé, l'intercepteur
   * (T-23b) peut répondre lui-même avec `conflictResponseBody`.
   */
  readonly details: { conflicts: BookingConflict[] };

  constructor(conflicts: BookingConflict[]) {
    super(409, bookingConflictMessage(conflicts), { code: "CONFLICT" });
    this.conflicts = conflicts;
    this.details = { conflicts };
  }
}

/** Corps de réponse conforme à `bookingConflictResponseSchema`. */
export function conflictResponseBody(error: BookingConflictError, requestId?: string) {
  return { message: error.message, code: "CONFLICT" as const, requestId, conflicts: error.conflicts };
}

export interface BookingGuardDeps {
  load?: typeof loadActiveOrders;
  executor?: unknown;
}

/**
 * Garde à appeler avant l'écriture d'un OT. `candidate` = corps fusionné avec la
 * ligne existante ; l'OT s'exclut lui-même (`id`). Lève `BookingConflictError`.
 */
export async function bookingGuard(candidate: BookingCandidate, deps: BookingGuardDeps = {}): Promise<void> {
  if (!candidate.from) return;
  const load = deps.load ?? loadActiveOrders;
  const executor = deps.executor ?? (await import("../db")).db;
  const existing = await load(executor, candidate.technicianId, candidate.vehicleId);
  const conflicts = findBookingConflicts(candidate, existing);
  if (conflicts.length > 0) throw new BookingConflictError(conflicts);
}
