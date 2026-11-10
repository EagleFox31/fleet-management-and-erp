import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { assignments, vehicles } from "@shared/schema";
import { ACTIVE_ASSIGNMENT_STATUSES, isTrailerVehicleType } from "@shared/constants/assignments";
import { AppError } from "../lib/app-error";
import { isUniqueViolation, pgConstraintOf } from "../lib/pg-errors";
import type { db } from "../db";

type Executor = Pick<typeof db, "select" | "execute">;

export const TRAILER_ACTIVE_INDEX = "uq_assignments_trailer_active";
export const TRAILER_ALREADY_HITCHED_MESSAGE = "Cette remorque est déjà attelée à un autre camion sur une affectation en cours.";
export const TRAILER_WRONG_TYPE_MESSAGE = "Le véhicule choisi comme remorque doit être de type remorque ou semi-remorque.";
export const TRAILER_IS_TRUCK_MESSAGE = "La remorque ne peut pas être le camion de l'affectation.";

export type TrailerCheck = {
  trailerId: number;
  vehicleId: number;
  /** Affectation en cours de modification : son propre attelage ne compte pas comme conflit. */
  excludeAssignmentId?: number | null;
};

/**
 * Règles d'attelage, partagées par la création de mission, le PATCH et l'ajout d'affectation :
 * la remorque est un véhicule du parc de type remorque / semi-remorque, non supprimé, différent du
 * camion, et non attelée à une autre affectation active. Verrou consultatif sur la remorque (espace 3,
 * distinct des véhicules (1) et chauffeurs (2) de lockPlanningPairs) : deux affectations simultanées
 * de la même remorque se sérialisent, l'index unique partiel reste le dernier filet (409 par
 * trailerConflictToAppError, jamais un 500).
 */
export async function assertTrailerAssignable(tx: Executor, check: TrailerCheck): Promise<void> {
  const { trailerId, vehicleId, excludeAssignmentId } = check;
  if (trailerId === vehicleId) throw new AppError(400, TRAILER_IS_TRUCK_MESSAGE);
  const [trailer] = await tx
    .select({ id: vehicles.id, vehicleType: vehicles.vehicleType })
    .from(vehicles)
    .where(and(eq(vehicles.id, trailerId), isNull(vehicles.deletedAt)))
    .limit(1);
  if (!trailer) throw new AppError(400, "Remorque introuvable.");
  if (!isTrailerVehicleType(trailer.vehicleType)) throw new AppError(400, TRAILER_WRONG_TYPE_MESSAGE);

  await tx.execute(sql`SELECT pg_advisory_xact_lock(3, ${trailerId})`);
  const conditions = [eq(assignments.trailerId, trailerId), inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES])];
  if (excludeAssignmentId) conditions.push(ne(assignments.id, excludeAssignmentId));
  const [hitched] = await tx.select({ id: assignments.id }).from(assignments).where(and(...conditions)).limit(1);
  if (hitched) throw new AppError(409, TRAILER_ALREADY_HITCHED_MESSAGE);
}

/** Violation de l'index unique partiel (course perdue malgré le verrou) → 409 lisible ; sinon l'erreur d'origine. */
export function trailerConflictToAppError(error: unknown): unknown {
  if (isUniqueViolation(error) && pgConstraintOf(error) === TRAILER_ACTIVE_INDEX) {
    return new AppError(409, TRAILER_ALREADY_HITCHED_MESSAGE, { cause: error });
  }
  return error;
}
