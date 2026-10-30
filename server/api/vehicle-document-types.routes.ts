import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { vehicleDocumentTypes } from "@shared/schema";
import {
  createVehicleDocumentTypeRequestSchema,
  updateVehicleDocumentTypeRequestSchema,
  vehicleDocumentTypeCodeSchema,
} from "@shared/contracts/vehicle-document-types";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authorize, isAnyUser } from "../middleware/auth";

const log = moduleLogger("vehicle-document-types");
const router = Router();
const adminOnly = authorize(["admin"]);

/**
 * Référentiel des types de document véhicule (P-05).
 * Un type ne se supprime pas : il se désactive (`active = false`), car
 * `vehicle_documents.type` référence le code en texte libre.
 */

/** Liste ordonnée. Les types désactivés ne sont visibles que de l'administrateur (`?includeInactive=true`). */
router.get("/vehicle-document-types", isAnyUser, async (req, res, next) => {
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

router.post("/vehicle-document-types", adminOnly, async (req, res, next) => {
  try {
    const body = createVehicleDocumentTypeRequestSchema.parse(req.body);
    const [created] = await db.insert(vehicleDocumentTypes).values(body).onConflictDoNothing().returning();
    if (!created) throw new AppError(409, "Ce code de type de document existe déjà.");
    log.info({ code: created.code, requestId: req.requestId }, "type de document créé");
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/vehicle-document-types/:code", adminOnly, async (req, res, next) => {
  try {
    const parsedCode = vehicleDocumentTypeCodeSchema.safeParse(req.params.code);
    if (!parsedCode.success) throw new AppError(404, "Type de document introuvable.");
    const body = updateVehicleDocumentTypeRequestSchema.parse(req.body);
    const [updated] = await db
      .update(vehicleDocumentTypes)
      .set(body)
      .where(eq(vehicleDocumentTypes.code, parsedCode.data))
      .returning();
    if (!updated) throw new AppError(404, "Type de document introuvable.");
    log.info({ code: updated.code, requestId: req.requestId }, "type de document modifié");
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
