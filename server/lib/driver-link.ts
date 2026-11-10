import { eq, notInArray } from "drizzle-orm";
import { db } from "../db";
import { drivers, users } from "@shared/schema";
import { MISSION_READ_ROLES, type AppRole } from "@shared/constants/roles";
import { AppError } from "./app-error";

/**
 * Liaison d'une fiche chauffeur à un compte (`drivers.userId`). Le compte lié lit la fiche et ses
 * missions par `GET /api/drivers/me`, réservé à `MISSION_READ_ROLES` : un compte hors de ce groupe
 * (technicien, client) n'a rien à y lire, sa liaison est refusée à l'écriture.
 *
 * Les liaisons antérieures ne sont pas modifiées : `driversLinkedOutsideMissionReaders` les recense
 * en lecture seule (`scripts/audit-driver-links.ts`).
 */
export const DRIVER_LINK_ROLE_REFUSED_MESSAGE =
  "Ce compte ne peut pas être lié à une fiche chauffeur : seuls un compte chauffeur ou un compte du personnel d'exploitation le peuvent.";
export const DRIVER_LINK_USER_NOT_FOUND_MESSAGE = "Le compte à lier à cette fiche chauffeur est introuvable.";

export function isDriverLinkableRole(role: string): boolean {
  return MISSION_READ_ROLES.includes(role as AppRole);
}

/** Refuse (400) un compte inconnu ou hors `MISSION_READ_ROLES`. `null` ou absent : aucune liaison, permis. */
export async function assertDriverLinkableUser(userId: number | null | undefined): Promise<void> {
  if (userId === null || userId === undefined) return;
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(400, DRIVER_LINK_USER_NOT_FOUND_MESSAGE);
  if (!isDriverLinkableRole(user.role)) throw new AppError(400, DRIVER_LINK_ROLE_REFUSED_MESSAGE);
}

/** Fiches liées à un compte hors `MISSION_READ_ROLES` : identifiants et rôle seulement, aucune écriture. */
export async function driversLinkedOutsideMissionReaders(): Promise<{ driverId: number; userId: number; role: string }[]> {
  return db
    .select({ driverId: drivers.id, userId: users.id, role: users.role })
    .from(drivers)
    .innerJoin(users, eq(drivers.userId, users.id))
    .where(notInArray(users.role, [...MISSION_READ_ROLES] as (typeof users.role.enumValues)[number][]))
    .orderBy(drivers.id);
}
