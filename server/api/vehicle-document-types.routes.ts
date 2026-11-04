import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { vehicleDocumentTypes } from "@shared/schema";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  createVehicleDocumentTypeRequestSchema,
  updateVehicleDocumentTypeRequestSchema,
  vehicleDocumentTypeCodeSchema,
  type CreateVehicleDocumentTypeRequest,
  type UpdateVehicleDocumentTypeRequest,
} from "@shared/contracts/vehicle-document-types";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authorize, isStaff } from "../middleware/auth";
import { validateBody } from "../middleware/validate-body";

const log = moduleLogger("vehicle-document-types");
const router = Router();
/** Couche 2 : prévient les clients connectés ; le client ré-interroge `/api/vehicle-document-types`. */
function broadcastTypeChanged(code: string): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  broadcastUpdate("vehicle_document_type_changed", {
    entity: "vehicle_document_type",
    payload: { code },
    scope: REALTIME_EVENTS.vehicle_document_type_changed.scope,
  });
}

/**
 * Référentiel des types de document véhicule (P-05).
 * Un type ne se supprime pas : il se désactive (`active = false`), car
 * `vehicle_documents.type` référence le code en texte libre.
 */

/** Liste ordonnée. Les types désactivés ne sont visibles que de l'administrateur (`?includeInactive=true`). */
router.get("/vehicle-document-types", isStaff, async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    if (includeInactive && req.user?.role !== "admin") {
      throw new AppError(403, "Accès réservé à l'administrateur.");
    }
    const query = db.select().from(vehicleDocumentTypes);
    const rows = await (includeInactive ? query : query.where(eq(vehicleDocumentTypes.active, true))).orderBy(
      asc(vehicleDocumentTypes.sortOrder),
      asc(vehicleDocumentTypes.code),
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/vehicle-document-types", authorize(["admin"]), validateBody(createVehicleDocumentTypeRequestSchema), async (req, res, next) => {
  try {
    const body = req.body as CreateVehicleDocumentTypeRequest;
    const [created] = await db.insert(vehicleDocumentTypes).values(body).onConflictDoNothing().returning();
    if (!created) throw new AppError(409, "Ce code de type de document existe déjà.");
    log.info({ code: created.code, requestId: req.requestId }, "type de document créé");
    broadcastTypeChanged(created.code);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/vehicle-document-types/:code", authorize(["admin"]), validateBody(updateVehicleDocumentTypeRequestSchema), async (req, res, next) => {
  try {
    const parsedCode = vehicleDocumentTypeCodeSchema.safeParse(req.params.code);
    if (!parsedCode.success) throw new AppError(404, "Type de document introuvable.");
    const body = req.body as UpdateVehicleDocumentTypeRequest;
    const [updated] = await db
      .update(vehicleDocumentTypes)
      .set(body)
      .where(eq(vehicleDocumentTypes.code, parsedCode.data))
      .returning();
    if (!updated) throw new AppError(404, "Type de document introuvable.");
    log.info({ code: updated.code, requestId: req.requestId }, "type de document modifié");
    broadcastTypeChanged(updated.code);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
