import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { assignments, drivers } from "@shared/schema";

/**
 * Cloison des chauffeurs (AGENTS §11, pendant de `client-scope.ts`).
 *
 * Tout le personnel voit toutes les missions ; un chauffeur (`role = 'driver'`) ne voit et
 * n'agit que sur les missions où il est affecté (`assignments.driver_id`, lié au compte par
 * `drivers.user_id`).
 *
 * Portée renvoyée par `driverScopeOf` :
 * - `undefined` : pas un chauffeur, aucun filtre ;
 * - un identifiant de chauffeur : filtrer sur ce chauffeur ;
 * - `null` : compte chauffeur sans fiche liée, il ne voit rien.
 */

export type DriverScopeReader = { id: number; role: string };

export const OUT_OF_DRIVER_SCOPE_MESSAGE = "Accès refusé : cette mission ne vous est pas affectée.";
export const OUT_OF_DRIVER_PROFILE_MESSAGE = "Accès refusé : ce profil chauffeur n'est pas le vôtre.";

export async function driverScopeOf(reader: DriverScopeReader | undefined): Promise<number | null | undefined> {
  if (!reader || reader.role !== "driver") return undefined;
  const [row] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, reader.id)).limit(1);
  return row?.id ?? null;
}

/** Vrai si `reader` peut agir sur la mission : personnel libre, chauffeur seulement s'il y est affecté. */
export async function canAccessMissionAsDriver(reader: DriverScopeReader | undefined, missionId: number): Promise<boolean> {
  const scope = await driverScopeOf(reader);
  if (scope === undefined) return true;
  if (scope === null) return false;
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.missionId, missionId), eq(assignments.driverId, scope)))
    .limit(1);
  return Boolean(row);
}
