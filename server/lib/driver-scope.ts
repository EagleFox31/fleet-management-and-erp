import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { assignments, drivers } from "@shared/schema";
import { AppError } from "./app-error";
import type { ScopeReader } from "./client-scope";

/**
 * Cloison chauffeur (R-13) : un chauffeur n'accède qu'à sa propre fiche
 * (drivers.userId) et aux missions qui lui sont affectées. Le reste du
 * personnel n'est pas concerné. Hors périmètre : 403.
 */
const DRIVER_FORBIDDEN = "Accès refusé : cette fiche ne vous appartient pas.";
const MISSION_FORBIDDEN = "Accès refusé : cette mission ne vous est pas affectée.";

const INVALID_ID = "Identifiant invalide.";

export async function assertOwnDriverRecord(reader: ScopeReader | undefined, driverId: number): Promise<void> {
  if (reader?.role !== "driver") return;
  if (!Number.isInteger(driverId) || driverId <= 0) throw new AppError(400, INVALID_ID);
  const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!row || row.userId !== reader.id) throw new AppError(403, DRIVER_FORBIDDEN);
}

export async function assertOwnMission(reader: ScopeReader | undefined, missionId: number): Promise<void> {
  if (reader?.role !== "driver") return;
  if (!Number.isInteger(missionId) || missionId <= 0) throw new AppError(400, INVALID_ID);
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(drivers, eq(assignments.driverId, drivers.id))
    .where(and(eq(assignments.missionId, missionId), eq(drivers.userId, reader.id)))
    .limit(1);
  if (!row) throw new AppError(403, MISSION_FORBIDDEN);
}

/** Refuse un chauffeur sur une écriture réservée au personnel de gestion. */
export function refuseDriver(reader: ScopeReader | undefined): void {
  if (reader?.role === "driver") throw new AppError(403, "Accès refusé : action réservée au personnel de gestion.");
}

/**
 * DTO réduit : CNI, n° de permis et date de naissance ne sortent que pour les
 * rôles qui gèrent les chauffeurs (`isDriverManager`) et pour le chauffeur
 * lui-même sur sa propre fiche. Les autres rôles du personnel reçoivent la fiche sans ces champs.
 */
const DRIVER_MANAGER_ROLES = new Set(["admin", "logistics", "secretary"]);
const PERSONAL_FIELDS = ["birthDate", "cniNumber", "licenseNumber"] as const;

export function redactDriverPersonalData<T extends { userId?: number | null }>(row: T, reader: ScopeReader | undefined): T {
  // Sans lecteur identifie : version masquee (refus par defaut).
  if (reader && DRIVER_MANAGER_ROLES.has(reader.role)) return row;
  if (reader && reader.role === "driver" && row.userId === reader.id) return row;
  const copy: Record<string, unknown> = { ...row };
  for (const field of PERSONAL_FIELDS) delete copy[field];
  return copy as T;
}

export function redactDriverList<T extends { userId?: number | null }>(rows: T[], reader: ScopeReader | undefined): T[] {
  return rows.map((row) => redactDriverPersonalData(row, reader));
}
