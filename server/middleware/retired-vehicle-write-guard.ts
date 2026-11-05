import { Router, type RequestHandler } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  documentRenewalRequests,
  fuelRecords,
  maintenanceSchedules,
  partRequirements,
  partsUsed,
  vehicleDocuments,
  vehicles,
  vehicleTires,
  workOrderItems,
  workOrders,
} from "@shared/schema";
import { db } from "../db";
import { findActiveSessionUser } from "../services/session-user";
import { vehicleEditRefusal } from "../lib/vehicle-retired";
import {
  asVehicleRef,
  readBodyPath,
  routeParts,
  RETIRED_VEHICLE_WRITE_ROUTES,
  type VehicleLookup,
  type VehicleSource,
} from "../lib/retired-vehicle-write-routes";

type Lookup = (id: number) => Promise<Array<number | null | undefined>>;

const byWorkOrder = async (workOrderId: number | null | undefined) => {
  if (workOrderId == null) return [];
  const [row] = await db.select({ v: workOrders.vehicleId }).from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
  return [row?.v];
};

/** Véhicule(s) d'un objet rattaché ; objet absent : liste vide, la route répond 404. */
const LOOKUPS: Record<VehicleLookup, Lookup> = {
  workOrder: (id) => byWorkOrder(id),
  maintenanceSchedule: async (id) =>
    (await db.select({ v: maintenanceSchedules.vehicleId }).from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id)).limit(1)).map((r) => r.v),
  // Plein supprimé : aucun véhicule, la route répond 404 comme avant.
  fuelRecord: async (id) =>
    (await db.select({ v: fuelRecords.vehicleId }).from(fuelRecords).where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt))).limit(1)).map((r) => r.v),
  vehicleTire: async (id) => (await db.select({ v: vehicleTires.vehicleId }).from(vehicleTires).where(eq(vehicleTires.id, id)).limit(1)).map((r) => r.v),
  vehicleDocument: async (id) =>
    (await db.select({ v: vehicleDocuments.vehicleId }).from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).limit(1)).map((r) => r.v),
  renewalRequest: async (id) =>
    (await db.select({ v: documentRenewalRequests.vehicleId }).from(documentRenewalRequests).where(eq(documentRenewalRequests.id, id)).limit(1)).map((r) => r.v),
  partUsed: async (id) => {
    const [row] = await db.select({ wo: partsUsed.workOrderId }).from(partsUsed).where(eq(partsUsed.id, id)).limit(1);
    return byWorkOrder(row?.wo);
  },
  workOrderItem: async (id) => {
    const [row] = await db.select({ wo: workOrderItems.workOrderId }).from(workOrderItems).where(eq(workOrderItems.id, id)).limit(1);
    return byWorkOrder(row?.wo);
  },
  partRequirement: async (id) => {
    const [row] = await db
      .select({ v: partRequirements.vehicleId, wo: partRequirements.workOrderId })
      .from(partRequirements)
      .where(eq(partRequirements.id, id))
      .limit(1);
    return row ? [row.v, ...(await byWorkOrder(row.wo))] : [];
  },
};

/** Refus (409) si l'un des véhicules est retiré ; null sinon. */
export async function retiredVehicleRefusal(vehicleIds: Array<number | null | undefined>) {
  const ids = [...new Set(vehicleIds.filter((id): id is number => typeof id === "number"))];
  if (ids.length === 0) return null;
  const rows = await db.select({ deletedAt: vehicles.deletedAt }).from(vehicles).where(inArray(vehicles.id, ids));
  return rows.map(vehicleEditRefusal).find((refusal) => refusal !== null) ?? null;
}

/** Pour une poignée qui ne connaît le véhicule qu'après analyse du corps (multipart) : lève le 409. */
export async function assertVehicleWritable(vehicleId: unknown): Promise<void> {
  const refusal = await retiredVehicleRefusal([asVehicleRef(vehicleId)]);
  if (refusal) throw refusal;
}

async function vehiclesOf(source: VehicleSource, params: Record<string, string>, body: unknown) {
  const raw = "param" in source ? params[source.param] : readBodyPath(body, source.body);
  const ref = asVehicleRef(raw);
  if (ref === null) return [];
  return "lookup" in source ? LOOKUPS[source.lookup](ref) : [ref];
}

const refuseIfRetired = (vehicle: VehicleSource[]): RequestHandler => async (req, _res, next) => {
  try {
    if (!req.session?.userId) return next();
    const user = await findActiveSessionUser(req.session.userId);
    if (!user || user.role === "client") return next();
    const found = (await Promise.all(vehicle.map((source) => vehiclesOf(source, req.params, req.body)))).flat();
    const refusal = await retiredVehicleRefusal(found);
    return refusal ? next(refusal) : next();
  } catch (error) {
    next(error);
  }
};

/**
 * Garde montée dans `apiRouter` (server/api/index.ts), donc avant `registerRoutes` : couvre aussi
 * les routes de `server/routes.ts` sans y ajouter de ligne. Chaque entrée de la table y est déclarée
 * comme une route Express : la correspondance (casse, `%xx`, barre finale, paramètres) est celle des
 * routes servies. N'agit que pour le personnel connecté, qui lit déjà les véhicules retirés : le 409
 * ne lui apprend rien. Sans session ou pour un client, la route répond elle-même (401, 403), comme avant.
 */
const matcher = Router();
for (const entry of RETIRED_VEHICLE_WRITE_ROUTES) {
  const { method, path } = routeParts(entry.route);
  matcher[method](path, refuseIfRetired(entry.vehicle));
}

// Enveloppé dans une fonction : ces couches ne servent aucune réponse (elles appellent `next()`), le
// recensement des routes de `api-auth-guard` ne doit pas les prendre pour des points d'entrée ouverts.
export const retiredVehicleWriteGuard: RequestHandler = (req, res, next) => matcher(req, res, next);
