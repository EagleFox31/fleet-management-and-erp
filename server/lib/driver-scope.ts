import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { assignments, drivers } from "@shared/schema";
import { canReadDriverPersonalData } from "@shared/constants/roles";

/**
 * Cloison des chauffeurs (AGENTS §11, pendant de `client-scope.ts`).
 *
 * Tout le personnel voit toutes les missions ; un chauffeur (`role = 'driver'`) ne voit et
 * n'agit que sur les missions où il est affecté (`assignments.driver_id`, lié au compte par
 * `drivers.user_id`).
 *
 * Une fiche par compte depuis #113 (index unique partiel uq_drivers_user_id, server/init-database.ts).
 * L'index n'est pas posé tant que des doublons existent : la portée reste donc l'union des fiches du
 * compte, sans dépendre de l'ordre de lecture. Sans danger une fois l'index posé (une seule fiche).
 *
 * Portée renvoyée par `driverScopeOf` :
 * - `undefined` : pas un chauffeur, aucun filtre ;
 * - un tableau d'identifiants de chauffeur : filtrer sur ces fiches ;
 * - tableau vide : compte chauffeur sans fiche liée, il ne voit rien.
 */

export type DriverScopeReader = { id: number; role: string };

export const OUT_OF_DRIVER_SCOPE_MESSAGE = "Accès refusé : cette mission ne vous est pas affectée.";
export const OUT_OF_DRIVER_PROFILE_MESSAGE = "Accès refusé : ce profil chauffeur n'est pas le vôtre.";

export async function driverScopeOf(reader: DriverScopeReader | undefined): Promise<number[] | undefined> {
  if (!reader || reader.role !== "driver") return undefined;
  const rows = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, reader.id));
  return rows.map((r) => r.id);
}

/** Vrai si `reader` peut agir sur la mission : personnel libre, chauffeur seulement s'il y est affecté. */
export async function canAccessMissionAsDriver(reader: DriverScopeReader | undefined, missionId: number): Promise<boolean> {
  const scope = await driverScopeOf(reader);
  if (scope === undefined) return true;
  if (scope.length === 0) return false;
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.missionId, missionId), inArray(assignments.driverId, scope)))
    .limit(1);
  return Boolean(row);
}

export const DRIVER_CPC_FORBIDDEN_MESSAGE = "Accès refusé : la certification CPC est saisie par l'exploitation.";

/**
 * Données personnelles de la fiche chauffeur : lisibles par les gestionnaires et la direction
 * (`DRIVER_PERSONAL_DATA_READER_ROLES`) et par le chauffeur concerné, retirées pour tout autre
 * lecteur.
 */
export const DRIVER_PERSONAL_FIELDS = [
  "birthDate",
  "cniNumber",
  "cniExpiry",
  "licenseNumber",
  "licenseExpiry",
  "hireDate",
] as const;

/** Retire les champs personnels d'une fiche (sans la modifier). */
export function stripDriverPersonalData<T extends Record<string, any>>(row: T): T {
  const copy: Record<string, any> = { ...row };
  for (const field of DRIVER_PERSONAL_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Applique la règle de lecture aux fiches chauffeur : gestionnaire = tout ; chauffeur = ses
 * propres fiches complètes, les autres sans données personnelles ; autre personnel = sans.
 */
export async function redactDriverPersonalData<T extends { id: number } & Record<string, any>>(
  reader: DriverScopeReader | undefined,
  data: T,
): Promise<T>;
export async function redactDriverPersonalData<T extends { id: number } & Record<string, any>>(
  reader: DriverScopeReader | undefined,
  data: T[],
): Promise<T[]>;
export async function redactDriverPersonalData<T extends { id: number } & Record<string, any>>(
  reader: DriverScopeReader | undefined,
  data: T | T[],
): Promise<T | T[]> {
  if (reader && canReadDriverPersonalData(reader.role)) return data;
  const own = new Set((await driverScopeOf(reader)) ?? []);
  const apply = (row: T): T => (own.has(row.id) ? row : stripDriverPersonalData(row));
  return Array.isArray(data) ? data.map(apply) : apply(data);
}
