import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import { users, vehicles, type Vehicle } from "@shared/schema";
import { escapeLike } from "../lib/sql-like";

export interface VehicleListQuery {
  search?: string;
  status?: string;
  vehicleType?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** Propriétaire imposé (`ownerScopeOf`) : `null` ou absent pour le personnel. */
  ownerId?: number | null;
}

export const VEHICLE_LIST_DEFAULT_LIMIT = 10;
export const VEHICLE_LIST_MAX_LIMIT = 1000;

/** Entier de requête borné ; repli sur `fallback` si la valeur n'est pas un entier sûr. */
export function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min) return fallback;
  return Math.min(n, max);
}

const sortColumns = {
  registrationNumber: vehicles.registrationNumber,
  brand: vehicles.brand,
  model: vehicles.model,
  engineSpec: vehicles.engineSpec,
  status: vehicles.status,
  nextMaintenanceDate: vehicles.nextMaintenanceDate,
  mileage: vehicles.mileage,
  year: vehicles.year,
  vehicleType: vehicles.vehicleType,
  licensePlateExpiry: vehicles.licensePlateExpiry,
} as const;

/**
 * Liste paginée des véhicules, cloisonnée par propriétaire pour un client
 * (AGENTS.md §11). Même forme de réponse que `storage.getVehicles`.
 */
export async function listVehicles(q: VehicleListQuery): Promise<{ vehicles: Vehicle[]; total: number }> {
  const conditions: SQL[] = [isNull(vehicles.deletedAt)];
  if (typeof q.ownerId === "number") conditions.push(eq(vehicles.ownerId, q.ownerId));

  const term = q.search ? escapeLike(q.search.trim()) : "";
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(vehicles.registrationNumber, pattern),
        ilike(vehicles.brand, pattern),
        ilike(vehicles.model, pattern),
        ilike(vehicles.engineSpec, pattern),
        ilike(vehicles.vin, pattern),
      )!,
    );
  }
  if (q.status) conditions.push(eq(vehicles.status, q.status as Vehicle["status"]));
  if (q.vehicleType) conditions.push(eq(vehicles.vehicleType, q.vehicleType as Vehicle["vehicleType"]));
  const where = and(...conditions);

  const sortColumn = q.sortBy && q.sortBy in sortColumns ? sortColumns[q.sortBy as keyof typeof sortColumns] : vehicles.createdAt;
  // `id` départage les ex æquo : des pages sans doublon ni trou.
  const order = q.sortOrder === "asc" ? [asc(sortColumn), asc(vehicles.id)] : [desc(sortColumn), desc(vehicles.id)];

  const rows = await db
    .select()
    .from(vehicles)
    .where(where)
    .orderBy(...order)
    .limit(q.limit ?? VEHICLE_LIST_DEFAULT_LIMIT)
    .offset(q.offset ?? 0);
  const [totalRow] = await db.select({ count: count() }).from(vehicles).where(where);

  const creatorIds = Array.from(new Set(rows.map((v) => v.createdBy).filter((v): v is number => typeof v === "number")));
  const names = new Map<number, string>();
  if (creatorIds.length > 0) {
    for (const c of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds))) {
      names.set(c.id, c.name);
    }
  }
  return {
    vehicles: rows.map((v) => ({
      ...v,
      createdByName: typeof v.createdBy === "number" ? (names.get(v.createdBy) ?? null) : null,
    })) as Vehicle[],
    total: Number(totalRow?.count ?? 0),
  };
}
