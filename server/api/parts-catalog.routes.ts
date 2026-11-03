import { Router } from "express";
import {
  insertPartSchema,
  insertPartSpecificationSchema,
  insertPartVariantSchema,
  updatePartSpecificationSchema,
  updatePartVariantSchema,
} from "@shared/schema";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { idParam, makeFailWith } from "../lib/route-helpers";
import { isUniqueViolation } from "../lib/pg-errors";
import { authenticate, isAdmin, isPartsCatalogManager, isStaff } from "../middleware/auth";
import { partCatalogChildrenService } from "../services/part-catalog-children-service";
import { partsService } from "../services/parts-service";

const log = moduleLogger("parts-catalog");
const router = Router();

const failWith = makeFailWith(log);

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

/**
 * Spécifications et variantes d'une fiche pièce (PRT1). Lecture : tout le personnel (le technicien et
 * l'atelier choisissent une variante dans une demande) ; écriture : admin et magasin (isPartsCatalogManager).
 * Référentiel : pas d'événement temps réel, la liste se relit à l'ouverture de la fiche.
 */
router.get("/parts/:id([0-9]+)/specifications", isStaff, async (req, res, next) => {
  try {
    return res.json(await partCatalogChildrenService.listSpecifications(idParam(req.params.id, "Identifiant de pièce")));
  } catch (err) {
    return failWith(err, req, next, "Échec de la lecture des spécifications de la pièce");
  }
});

router.post("/parts/:id([0-9]+)/specifications", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = insertPartSpecificationSchema.parse(req.body ?? {});
    const created = await partCatalogChildrenService.createSpecification(idParam(req.params.id, "Identifiant de pièce"), data);
    return res.status(201).json(created);
  } catch (err) {
    return failWith(err, req, next, "Échec de la création de la spécification");
  }
});

router.patch("/parts/:id([0-9]+)/specifications/:specId([0-9]+)", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = updatePartSpecificationSchema.parse(req.body ?? {});
    const updated = await partCatalogChildrenService.updateSpecification(
      idParam(req.params.id, "Identifiant de pièce"),
      idParam(req.params.specId, "Identifiant de spécification"),
      data,
    );
    return res.json(updated);
  } catch (err) {
    return failWith(err, req, next, "Échec de la modification de la spécification");
  }
});

router.delete("/parts/:id([0-9]+)/specifications/:specId([0-9]+)", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    await partCatalogChildrenService.deleteSpecification(
      idParam(req.params.id, "Identifiant de pièce"),
      idParam(req.params.specId, "Identifiant de spécification"),
    );
    return res.status(204).send();
  } catch (err) {
    return failWith(err, req, next, "Échec de la suppression de la spécification");
  }
});

router.get("/parts/:id([0-9]+)/variants", isStaff, async (req, res, next) => {
  try {
    return res.json(await partCatalogChildrenService.listVariants(idParam(req.params.id, "Identifiant de pièce")));
  } catch (err) {
    return failWith(err, req, next, "Échec de la lecture des variantes de la pièce");
  }
});

router.post("/parts/:id([0-9]+)/variants", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = insertPartVariantSchema.parse(req.body ?? {});
    const created = await partCatalogChildrenService.createVariant(idParam(req.params.id, "Identifiant de pièce"), data);
    return res.status(201).json(created);
  } catch (err) {
    return failWith(err, req, next, "Échec de la création de la variante");
  }
});

router.patch("/parts/:id([0-9]+)/variants/:variantId([0-9]+)", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = updatePartVariantSchema.parse(req.body ?? {});
    const updated = await partCatalogChildrenService.updateVariant(
      idParam(req.params.id, "Identifiant de pièce"),
      idParam(req.params.variantId, "Identifiant de variante"),
      data,
    );
    return res.json(updated);
  } catch (err) {
    return failWith(err, req, next, "Échec de la modification de la variante");
  }
});

router.delete("/parts/:id([0-9]+)/variants/:variantId([0-9]+)", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    await partCatalogChildrenService.deleteVariant(
      idParam(req.params.id, "Identifiant de pièce"),
      idParam(req.params.variantId, "Identifiant de variante"),
    );
    return res.status(204).send();
  } catch (err) {
    return failWith(err, req, next, "Échec de la suppression de la variante");
  }
});

export default router;
