import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { fuelRecords, users, vehicles } from "@shared/schema";

/**
 * Lectures de véhicules cloisonnées sur le propriétaire (AGENTS.md §11).
 * Même forme de réponse que `storage.getVehicles` (`{ vehicles, total }`,
 * `createdByName` ajouté), avec le filtre `vehicles.ownerId` en plus.
 */

export type ScopedVehicleQuery = {
  search?: string;
  status?: string;
  vehicleType?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

const SORT_COLUMNS = {
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

type Vehicle = typeof vehicles.$inferSelect;

export async function listVehiclesForOwner(ownerId: number, query: ScopedVehicleQuery = {}) {
  const conditions: SQL[] = [isNull(vehicles.deletedAt), eq(vehicles.ownerId, ownerId)];

  const search = query.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
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
  if (query.status) conditions.push(eq(vehicles.status, query.status as Vehicle["status"]));
  if (query.vehicleType) conditions.push(eq(vehicles.vehicleType, query.vehicleType as Vehicle["vehicleType"]));

  const where = and(...conditions);
  const sortColumn =
    query.sortBy && Object.hasOwn(SORT_COLUMNS, query.sortBy)
      ? SORT_COLUMNS[query.sortBy as keyof typeof SORT_COLUMNS]
      : vehicles.createdAt;
  const orderBy = query.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select()
    .from(vehicles)
    .where(where)
    .orderBy(orderBy)
    .limit(query.limit ?? 10)
    .offset(query.offset ?? 0);
  const [totalRow] = await db.select({ count: count() }).from(vehicles).where(where);

  const creatorIds = [...new Set(rows.map((v) => v.createdBy).filter((id): id is number => typeof id === "number"))];
  const names = new Map<number, string>();
  if (creatorIds.length > 0) {
    const creators = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds));
    for (const creator of creators) names.set(creator.id, creator.name);
  }

  return {
    vehicles: rows.map((v) => ({
      ...v,
      createdByName: typeof v.createdBy === "number" ? (names.get(v.createdBy) ?? null) : null,
    })),
    total: Number(totalRow?.count ?? 0),
  };
}

/** Véhicule du propriétaire pour cette immatriculation ; `undefined` hors périmètre comme inexistant. */
export async function findOwnedVehicleByRegistration(ownerId: number, registrationNumber: string) {
  const [row] = await db
    .select({ id: vehicles.id, registrationNumber: vehicles.registrationNumber })
    .from(vehicles)
    .where(and(eq(vehicles.registrationNumber, registrationNumber), eq(vehicles.ownerId, ownerId)));
  return row;
}

const PERIOD_MONTHS: Record<string, number> = { month: 1, quarter: 3 };

/** Debut de periode (meme regle que la statistique carburant de routes.ts). */
function periodStart(period: string, now = new Date()): string {
  const d = new Date(now);
  if (period === "week") d.setDate(d.getDate() - 7);
  else if (period === "year") d.setFullYear(d.getFullYear() - 1);
  else d.setMonth(d.getMonth() - (PERIOD_MONTHS[period] ?? 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Statistique carburant d'un client : agregat SQL limite a ses vehicules.
 * Meme forme que `GET /api/fuel-records/statistics` ({ period, totalFuel, totalCost, vehicleStats }).
 */
export async function fuelStatisticsForOwner(ownerId: number, period: string) {
  const rows = await db
    .select({
      vehicleId: vehicles.id,
      registrationNumber: vehicles.registrationNumber,
      brand: vehicles.brand,
      model: vehicles.model,
      fuel: sql<number>`coalesce(sum(${fuelRecords.quantity}), 0)`.mapWith(Number),
      cost: sql<number>`coalesce(sum(${fuelRecords.cost}), 0)`.mapWith(Number),
      recordCount: count(fuelRecords.id),
    })
    .from(fuelRecords)
    .innerJoin(vehicles, eq(fuelRecords.vehicleId, vehicles.id))
    .where(and(eq(vehicles.ownerId, ownerId), gte(fuelRecords.date, periodStart(period))))
    .groupBy(vehicles.id, vehicles.registrationNumber, vehicles.brand, vehicles.model);
  const vehicleStats = rows.map((row) => ({ ...row, distance: 0, avgConsumption: 0 }));
  return {
    period,
    totalFuel: vehicleStats.reduce((sum, row) => sum + row.fuel, 0),
    totalCost: vehicleStats.reduce((sum, row) => sum + row.cost, 0),
    vehicleStats,
  };
}
