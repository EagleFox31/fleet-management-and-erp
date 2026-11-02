import { Router } from "express";
import { eq } from "drizzle-orm";
import { faultCatalog } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { prepareColumnUpdate } from "../lib/column-validation";
import { moduleLogger } from "../lib/logger";
import { isWorkshopManager } from "../middleware/auth";

const log = moduleLogger("fault-catalog");
const router = Router();

/**
 * Modification d'une fiche du catalogue de pannes. Montée avant le PATCH
 * homonyme de server/routes.ts (gelé).
 *
 * Le valideur n'est jamais repris du corps : il est posé par le serveur au
 * passage à `validated` (compte connecté), effacé au retour en brouillon.
 */
router.patch("/fault-catalog/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, "ID invalide");
    }

    const {
      id: _id,
      createdBy: _createdBy,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      validatedBy: _validatedBy,
      ...catalogPayload
    } = req.body ?? {};
    const { data, errors } = prepareColumnUpdate(faultCatalog, catalogPayload);
    if (errors.length > 0) {
      throw new AppError(400, "Certaines informations de la panne sont invalides.", { fieldErrors: errors });
    }

    const update: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.status === "validated") {
      update.validatedBy = req.user?.id ?? null;
    } else if (data.status === "draft") {
      update.validatedBy = null;
    }

    const [catalog] = await db.update(faultCatalog).set(update).where(eq(faultCatalog.id, id)).returning();
    if (!catalog) {
      throw new AppError(404, "Cette fiche du catalogue n'existe pas.");
    }
    return res.json(catalog);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    log.error({ err, requestId: req.requestId }, "Échec de la modification de la fiche du catalogue de pannes");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

export default router;
