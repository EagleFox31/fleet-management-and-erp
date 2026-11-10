import { Router, type Request, type RequestHandler, type Response } from "express";
import { eq } from "drizzle-orm";
import { BOOKING_ACTIVE_STATUSES } from "@shared/contracts/work-order-booking";
import { workOrders } from "@shared/schema";
import { db } from "../db";
import { bookingGuard } from "../services/work-order-booking";
import { isTechnician, isWorkshopManager } from "./auth";

/**
 * Double affectation (P-08, T-23b) : refus 409 avant l'écriture d'un OT dont le technicien ou le
 * véhicule est déjà pris sur le même créneau. Monté sur `/work-orders`, il ne regarde que
 * `POST /` et `PATCH /:id` ; sans session il passe la main (la route répond 401 elle-même).
 * La correspondance passe par un `Router` Express (`POST /`, `PATCH /:id`), jamais par une regex sur
 * `req.path` : casse, `%xx` et barre finale sont lus comme par les routes servies (`/%36%32` = `/62`).
 * Le corps est fusionné avec la ligne existante ; un PATCH qui ne change ni ressource, ni créneau,
 * ni statut ne déclenche aucune vérification. Le rôle est contrôlé avant la première lecture en base. Pas d'événement temps réel : un refus n'est pas une transition.
 */

const SLOT_FIELDS = ["technicianId", "vehicleId", "startDate", "endDate", "status"] as const;
type SlotFields = { [K in (typeof SLOT_FIELDS)[number]]?: unknown };

const toDate = (value: unknown): Date | null => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const toId = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};
const sameSlot = (a: SlotFields, b: SlotFields) =>
  toId(a.technicianId) === toId(b.technicianId) &&
  toId(a.vehicleId) === toId(b.vehicleId) &&
  toDate(a.startDate)?.getTime() === toDate(b.startDate)?.getTime() &&
  toDate(a.endDate)?.getTime() === toDate(b.endDate)?.getTime() &&
  a.status === b.status;

/**
 * Rejoue la garde de rôle de la route protégée avant toute lecture : elle répond elle-même (401/403)
 * et la promesse vaut `false`, ou appelle `next` et la promesse vaut `true`.
 */
function passesRoleGuard(guard: RequestHandler, req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve, reject) => {
    res.once("finish", () => resolve(false));
    res.once("close", () => resolve(false));
    Promise.resolve(guard(req, res, (error?: unknown) => (error ? reject(error) : resolve(true)))).catch(reject);
  });
}

const guardWrite = (isCreate: boolean): RequestHandler => async (req, res, next) => {
  try {
    // Id décodé par Express ; un id non entier est laissé à la route (400 ou 404).
    const patchId = isCreate ? undefined : /^\d+$/.test(req.params.id ?? "") ? req.params.id : undefined;
    if ((!isCreate && !patchId) || !req.session?.userId) return next();
    // Mêmes rôles que les routes d'écriture (POST : atelier ; PATCH : technicien compris), avant toute lecture.
    if (!(await passesRoleGuard(isCreate ? isWorkshopManager : isTechnician, req, res))) return;

    const body = (req.body ?? {}) as SlotFields;
    let merged: SlotFields = body;
    let id: number | null = null;

    if (patchId) {
      id = Number(patchId);
      const [existing] = await db.select().from(workOrders).where(eq(workOrders.id, id));
      if (!existing) return next(); // la route répond 404
      merged = {
        technicianId: "technicianId" in body ? body.technicianId : existing.technicianId,
        vehicleId: "vehicleId" in body ? body.vehicleId : existing.vehicleId,
        startDate: "startDate" in body ? body.startDate : existing.startDate,
        endDate: "endDate" in body ? body.endDate : existing.endDate,
        status: "status" in body ? body.status : existing.status,
      };
      if (sameSlot(merged, existing)) return next();
    } else {
      merged = { ...body, status: "pending" }; // une création démarre toujours en attente
    }

    if (!(BOOKING_ACTIVE_STATUSES as readonly unknown[]).includes(merged.status)) return next();
    await bookingGuard({
      id,
      technicianId: toId(merged.technicianId),
      vehicleId: toId(merged.vehicleId),
      from: toDate(merged.startDate),
      to: toDate(merged.endDate),
    });
    next();
  } catch (error) {
    next(error);
  }
};

const matcher = Router();
matcher.post("/", guardWrite(true));
matcher.patch("/:id", guardWrite(false));

// Enveloppé dans une fonction : ces couches ne servent aucune réponse (elles appellent `next()`).
export const workOrderBookingGuard: RequestHandler = (req, res, next) => matcher(req, res, next);
