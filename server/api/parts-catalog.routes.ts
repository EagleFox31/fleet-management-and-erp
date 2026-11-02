import { Router } from "express";
import { insertPartSchema } from "@shared/schema";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isUniqueViolation } from "../lib/pg-errors";
import { authenticate, isAdmin, isPartsCatalogManager } from "../middleware/auth";
import { partsService } from "../services/parts-service";

const log = moduleLogger("parts-catalog");
const router = Router();

/**
 * Création et suppression de fiches pièce. Montées avant les handlers
 * homonymes de server/routes.ts (gelé) : Express sert la première déclaration.
 * Corps invalide : ZodError -> 400 par le gestionnaire central, jamais 500.
 */
router.post("/parts", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const parsedPart = insertPartSchema.parse(req.body);
    const part = await partsService.createPart(parsedPart, req.user?.id);
    return res.status(201).json(part);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    // Deux créations simultanées de la même référence : l'index UNIQUE tranche.
    if (isUniqueViolation(err)) {
      return next(new AppError(409, "Une pièce avec cette référence existe déjà", { cause: err }));
    }
    if (err instanceof Error && err.name === "ZodError") return next(err);
    log.error({ err, requestId: req.requestId }, "Échec de la création de la pièce");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

router.delete("/parts/:id([0-9]+)", isAdmin, async (req, res, next) => {
  try {
    await partsService.deletePart(Number.parseInt(req.params.id, 10));
    return res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    log.error({ err, requestId: req.requestId }, "Échec de la suppression de la pièce");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

export default router;
