import { Router } from "express";
import { eq } from "drizzle-orm";
import { faultCatalog, insertFaultCatalogPartSchema, updateFaultCatalogPartSchema } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { prepareColumnUpdate } from "../lib/column-validation";
import { moduleLogger } from "../lib/logger";
import { idParam, makeFailWith } from "../lib/route-helpers";
import { isStaff, isWorkshopManager } from "../middleware/auth";
import { faultCatalogService } from "../services/fault-catalog-service";
import { withLogContext } from "../lib/error-log-context";

const log = moduleLogger("fault-catalog");
const router = Router();

const failWith = makeFailWith(log);

/**
 * Modification d'une fiche du catalogue de pannes. Montée avant le PATCH
 * homonyme de server/routes.ts (gelé).
 *
 * Le valideur n'est jamais repris du corps : il est posé par le serveur au
 * passage à `validated` (compte connecté), effacé au retour en brouillon.
 */
router.patch("/fault-catalog/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "ID invalide");

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
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la modification de la fiche du catalogue de pannes" }));
  }
});

/**
 * Pièces associées à une panne (CAT2). Lecture : tout le personnel ; écriture : admin et chef d'atelier.
 * Règles métier (panne archivée figée, lien d'une autre panne, doublon) dans FaultCatalogService.
 */
router.get("/fault-catalog/:id([0-9]+)/parts", isStaff, async (req, res, next) => {
  try {
    return res.json(await faultCatalogService.listParts(idParam(req.params.id, "Identifiant de panne")));
  } catch (err) {
    return failWith(err, req, next, "Échec de la lecture des pièces de la panne");
  }
});

router.post("/fault-catalog/:id([0-9]+)/parts", isWorkshopManager, async (req, res, next) => {
  try {
    const data = insertFaultCatalogPartSchema.parse(req.body ?? {});
    const link = await faultCatalogService.addPart(idParam(req.params.id, "Identifiant de panne"), data);
    return res.status(201).json(link);
  } catch (err) {
    return failWith(err, req, next, "Échec de l'ajout d'une pièce à la panne");
  }
});

router.patch("/fault-catalog/:id([0-9]+)/parts/:linkId([0-9]+)", isWorkshopManager, async (req, res, next) => {
  try {
    const data = updateFaultCatalogPartSchema.parse(req.body ?? {});
    const link = await faultCatalogService.updatePart(
      idParam(req.params.id, "Identifiant de panne"),
      idParam(req.params.linkId, "Identifiant de lien"),
      data,
    );
    return res.json(link);
  } catch (err) {
    return failWith(err, req, next, "Échec de la modification d'une pièce de la panne");
  }
});

router.delete("/fault-catalog/:id([0-9]+)/parts/:linkId([0-9]+)", isWorkshopManager, async (req, res, next) => {
  try {
    await faultCatalogService.removePart(idParam(req.params.id, "Identifiant de panne"), idParam(req.params.linkId, "Identifiant de lien"));
    return res.status(204).send();
  } catch (err) {
    return failWith(err, req, next, "Échec du retrait d'une pièce de la panne");
  }
});

export default router;
