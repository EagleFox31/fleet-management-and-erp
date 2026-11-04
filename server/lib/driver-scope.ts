import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db";
import { assignments, drivers, missions } from "@shared/schema";
import { canReadDriverPersonalData } from "@shared/constants/roles";
import { ACTIVE_ASSIGNMENT_STATUSES, VOID_ASSIGNMENT_STATUSES, isVoidAssignmentStatus } from "@shared/constants/assignments";

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

/**
 * Filtre unique « affectation vivante de l'un de ces chauffeurs » : sur ses fiches, hors annulée ou
 * refusée (`VOID_ASSIGNMENT_STATUSES`). Toute lecture cloisonnée par chauffeur passe par ici : un
 * filtre sur `assignments.driverId` seul rend au chauffeur retiré une mission qu'il n'a plus à voir
 * (#240, garde-fou tests/unit/server/assignment-write-hygiene.test.ts).
 */
export function driverLiveAssignmentFilter(driverIds: number[]) {
  return and(inArray(assignments.driverId, driverIds), notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES]))!;
}

/** Missions où l'un de ces chauffeurs a une affectation vivante (listes cloisonnées). */
export function missionsOfDriversFilter(driverIds: number[]) {
  return inArray(missions.id, db.select({ id: assignments.missionId }).from(assignments).where(driverLiveAssignmentFilter(driverIds)));
}

/**
 * Vrai si `reader` peut agir sur la mission : personnel libre, chauffeur seulement s'il y est affecté.
 * Une affectation annulée ou refusée ne compte pas : le chauffeur retiré de la mission n'y a plus accès.
 * Une affectation terminée garde l'accès (historique de ses missions).
 */
export async function canAccessMissionAsDriver(reader: DriverScopeReader | undefined, missionId: number): Promise<boolean> {
  const scope = await driverScopeOf(reader);
  if (scope === undefined) return true;
  if (scope.length === 0) return false;
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.missionId, missionId), driverLiveAssignmentFilter(scope)))
    .limit(1);
  return Boolean(row);
}

/**
 * Une mission peut avoir plusieurs chauffeurs (une ligne `assignments` par chauffeur, aucune unicité
 * sur `mission_id`). Un droit d'agir sur la mission se lit donc sur l'ensemble des lignes, jamais sur
 * « la » première.
 *
 * Affectations du compte sur la mission, encore actives (`ACTIVE_ASSIGNMENT_STATUSES`) : une
 * affectation annulée, refusée ou terminée ne donne aucun droit de saisie. Ordre stable (id).
 * Vide pour un compte sans fiche chauffeur ou hors mission.
 */
export async function activeDriverAssignmentsOnMission(
  reader: DriverScopeReader,
  missionId: number,
): Promise<{ id: number; vehicleId: number | null; driverId: number }[]> {
  const scope = (await driverScopeOf(reader)) ?? [];
  if (scope.length === 0) return [];
  const rows = await db
    .select({ id: assignments.id, vehicleId: assignments.vehicleId, driverId: assignments.driverId })
    .from(assignments)
    .where(
      and(
        eq(assignments.missionId, missionId),
        inArray(assignments.driverId, scope),
        inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
      ),
    )
    .orderBy(asc(assignments.id));
  return rows.filter((r): r is { id: number; vehicleId: number | null; driverId: number } => r.driverId !== null);
}

/**
 * Véhicules d'une mission pour le personnel (saisie carburant, régularisation) : ceux de toutes ses
 * affectations, hors annulée ou refusée. Ordre stable (id), sans doublon.
 */
export async function missionVehicleIdsForStaff(missionId: number): Promise<number[]> {
  const rows = await db
    .select({ vehicleId: assignments.vehicleId })
    .from(assignments)
    .where(and(eq(assignments.missionId, missionId), notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES])))
    .orderBy(asc(assignments.id));
  return Array.from(new Set(rows.map((r) => r.vehicleId).filter((v): v is number => v !== null)));
}

/**
 * Affectation à présenter comme « l'affectation » d'une mission dans une réponse à valeur unique
 * (`assignment`). Chauffeur (`driverScope` défini) : uniquement les siennes, jamais celle d'un autre
 * chauffeur. Pour le chauffeur comme pour le personnel : la plus ancienne active d'abord, puis la plus
 * ancienne non annulée ni refusée, à défaut la plus ancienne. Ordre stable, indépendant de l'ordre de lecture.
 */
export function pickMissionAssignment<T extends { id: number; driverId: number | null; status: string }>(
  rows: T[],
  driverScope?: number[],
): T | null {
  const visible = (driverScope === undefined ? rows : rows.filter((r) => r.driverId !== null && driverScope.includes(r.driverId)))
    .slice()
    .sort((a, b) => a.id - b.id);
  const live = visible.filter((r) => !isVoidAssignmentStatus(r.status));
  const active = live.filter((r) => (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(r.status));
  return active[0] ?? live[0] ?? visible[0] ?? null;
}

/**
 * Véhicules affectés au compte : affectation sur l'une de ses fiches chauffeur, encore active
 * (`ACTIVE_ASSIGNMENT_STATUSES`). Une affectation terminée ou annulée n'en fait plus partie.
 * Règle commune aux pannes et au kilométrage.
 */
export async function assignedVehicleIdsOf(reader: DriverScopeReader): Promise<number[]> {
  const rows = await db
    .select({ vehicleId: assignments.vehicleId })
    .from(assignments)
    .innerJoin(drivers, eq(assignments.driverId, drivers.id))
    .where(and(eq(drivers.userId, reader.id), inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES])));
  return rows.map((r) => r.vehicleId).filter((v): v is number => v !== null);
}

export const OUT_OF_ASSIGNED_VEHICLE_MILEAGE_MESSAGE =
  "Vous ne pouvez saisir le kilométrage que du véhicule qui vous est affecté.";

/** Vrai si `reader` peut saisir le kilométrage du véhicule : personnel libre, chauffeur sur son véhicule affecté. */
export async function canWriteVehicleMileage(reader: DriverScopeReader | undefined, vehicleId: number): Promise<boolean> {
  if (!reader) return false;
  if (reader.role !== "driver") return true;
  return (await assignedVehicleIdsOf(reader)).includes(vehicleId);
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
