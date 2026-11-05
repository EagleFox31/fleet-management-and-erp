import { Router } from "express";
import { z } from "zod";
import {
  insertPartSchema,
  insertPartSpecificationSchema,
  insertPartVariantSchema,
  updatePartSpecificationSchema,
  updatePartVariantSchema,
  parts,
} from "@shared/schema";
import { PART_UNITS } from "@shared/constants/parts";
import { REALTIME_EVENTS, type RealtimeEventPayload } from "@shared/contracts/realtime-events";
import { prepareColumnUpdate } from "../lib/column-validation";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { makeFailWith } from "../lib/route-helpers";
import { isUniqueViolation } from "../lib/pg-errors";
import { authenticate, isAdmin, isInventoryManager, isPartsCatalogManager, isStaff } from "../middleware/auth";
import { partCatalogChildrenService } from "../services/part-catalog-children-service";
import { assertNoStockFields, partsService } from "../services/parts-service";
import { withLogContext } from "../lib/error-log-context";

const log = moduleLogger("parts-catalog");
const router = Router();

const failWith = makeFailWith(log);

// Sans contrainte `([0-9]+)` dans le chemin : un id illisible (« 1abc ») doit recevoir un 400, pas tomber dans le 404 du routeur.
const PART_ID_INVALID_MESSAGE = "Identifiant de pièce invalide.";
const SPEC_ID_INVALID_MESSAGE = "Identifiant de spécification invalide.";
const VARIANT_ID_INVALID_MESSAGE = "Identifiant de variante invalide.";
/**
 * Couche 2 (AGENTS.md §2) : toute écriture sur une fiche pièce prévient le personnel, qui
 * ré-interroge liste, détail et écrans du magasin. Portée PART_CATALOG_EVENT_ROLES : ni
 * chauffeur ni client (§11). Une diffusion en échec ne fait jamais échouer l'écriture.
 */
function broadcastPartCatalogChanged(payload: RealtimeEventPayload<"part_catalog_changed">, actorUserId?: number | null): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  try {
    broadcastUpdate("part_catalog_changed", {
      entity: "part",
      entityId: payload.id,
      payload,
      actor: { userId: actorUserId ?? null },
      scope: REALTIME_EVENTS.part_catalog_changed.scope,
    });
  } catch (err) {
    log.error({ err, partId: payload.id }, "diffusion temps réel du catalogue pièces en échec");
  }
}

/**
 * Création, modification, suppression et ajustement de stock d'une fiche pièce. Seule déclaration
 * de ces chemins (retirés de server/routes.ts). Corps invalide : ZodError -> 400 par le
 * gestionnaire central, jamais 500.
 */
router.post("/parts", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const parsedPart = insertPartSchema.parse(req.body);
    const part = await partsService.createPart(parsedPart, req.user?.id);
    broadcastPartCatalogChanged({ id: part.id, action: "created" }, req.user?.id);
    return res.status(201).json(part);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    // Deux créations simultanées de la même référence : l'index UNIQUE tranche.
    if (isUniqueViolation(err)) {
      return next(new AppError(409, "Une pièce avec cette référence existe déjà", { cause: err }));
    }
    if (err instanceof Error && err.name === "ZodError") return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la création de la pièce" }));
  }
});

router.delete("/parts/:id", isAdmin, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE);
    await partsService.deletePart(id);
    broadcastPartCatalogChanged({ id, action: "deleted" }, req.user?.id);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la suppression de la pièce" }));
  }
});

router.patch("/parts/:id", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE);
    // Le stock ne change que par `update-stock`, qui trace le mouvement et son motif : une
    // quantité dans le PATCH modifierait le stock sans aucune trace. Même refus côté service.
    assertNoStockFields(req.body);
    if (req.body?.unit !== undefined) {
      const normalizedUnit = typeof req.body.unit === "string" ? req.body.unit.trim() : "";
      if (!PART_UNITS.includes(normalizedUnit as (typeof PART_UNITS)[number])) {
        throw new AppError(400, "Unité invalide", { details: { allowedUnits: PART_UNITS } });
      }
      req.body.unit = normalizedUnit;
    }
    // Champs tenus par le serveur : jamais repris du corps (AGENTS.md §5).
    const {
      id: _id,
      createdBy: _createdBy,
      createdAt: _createdAt,
      updatedBy: _updatedBy,
      updatedAt: _updatedAt,
      ...partPayload
    } = req.body ?? {};
    const { data, errors } = prepareColumnUpdate(parts, partPayload);
    if (errors.length > 0) {
      throw new AppError(400, "Certaines informations de la pièce sont invalides.", { fieldErrors: errors });
    }
    const updatedPart = await partsService.updatePart(id, data, req.user?.id);
    broadcastPartCatalogChanged({ id, action: "updated" }, req.user?.id);
    return res.status(200).json(updatedPart);
  } catch (err) {
    // Le service signale ces deux cas par message : les traduire en statut plutôt que de
    // renvoyer le texte de l'erreur au client.
    if (err instanceof AppError) return next(err);
    const message = err instanceof Error ? err.message : "";
    if (message === "Pièce non trouvée") {
      return next(new AppError(404, "Cette pièce n'existe plus.", { cause: err }));
    }
    if (message === "Une pièce avec cette référence existe déjà") {
      return next(new AppError(409, "Une pièce avec cette référence existe déjà.", { cause: err }));
    }
    return failWith(err, req, next, "Échec de la modification de la pièce");
  }
});

const stockAdjustmentSchema = z.object({
  adjustment: z.coerce
    .number({ invalid_type_error: "L'ajustement doit être un nombre." })
    .int("L'ajustement doit être un nombre entier.")
    .refine((value) => value !== 0, "L'ajustement ne peut pas être nul."),
  reason: z
    .string({ required_error: "La raison de l'ajustement est obligatoire." })
    .trim()
    .min(1, "La raison de l'ajustement est obligatoire."),
});

router.post("/parts/:id/update-stock", authenticate, isInventoryManager, async (req, res, next) => {
  try {
    const partId = parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE);
    const { adjustment, reason } = stockAdjustmentSchema.parse(req.body);
    const updatedPart = await partsService.updateStock(partId, adjustment, reason, req.user?.id);
    broadcastPartCatalogChanged({ id: partId, action: "stock_adjusted" }, req.user?.id);
    return res.status(200).json(updatedPart);
  } catch (err) {
    // ZodError (400) et AppError (404, 409) : message métier et journalisation par le gestionnaire central.
    return next(err);
  }
});

/**
 * Spécifications et variantes d'une fiche pièce (PRT1). Lecture : tout le personnel (le technicien et
 * l'atelier choisissent une variante dans une demande) ; écriture : admin et magasin (isPartsCatalogManager).
 * Référentiel : pas d'événement temps réel, la liste se relit à l'ouverture de la fiche.
 */
router.get("/parts/:id/specifications", isStaff, async (req, res, next) => {
  try {
    return res.json(await partCatalogChildrenService.listSpecifications(parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE)));
  } catch (err) {
    return failWith(err, req, next, "Échec de la lecture des spécifications de la pièce");
  }
});

router.post("/parts/:id/specifications", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = insertPartSpecificationSchema.parse(req.body ?? {});
    const created = await partCatalogChildrenService.createSpecification(parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE), data);
    return res.status(201).json(created);
  } catch (err) {
    return failWith(err, req, next, "Échec de la création de la spécification");
  }
});

router.patch("/parts/:id/specifications/:specId", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = updatePartSpecificationSchema.parse(req.body ?? {});
    const updated = await partCatalogChildrenService.updateSpecification(
      parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE),
      parseRouteId(req.params.specId, SPEC_ID_INVALID_MESSAGE),
      data,
    );
    return res.json(updated);
  } catch (err) {
    return failWith(err, req, next, "Échec de la modification de la spécification");
  }
});

router.delete("/parts/:id/specifications/:specId", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    await partCatalogChildrenService.deleteSpecification(
      parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE),
      parseRouteId(req.params.specId, SPEC_ID_INVALID_MESSAGE),
    );
    return res.status(204).send();
  } catch (err) {
    return failWith(err, req, next, "Échec de la suppression de la spécification");
  }
});

router.get("/parts/:id/variants", isStaff, async (req, res, next) => {
  try {
    return res.json(await partCatalogChildrenService.listVariants(parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE)));
  } catch (err) {
    return failWith(err, req, next, "Échec de la lecture des variantes de la pièce");
  }
});

router.post("/parts/:id/variants", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = insertPartVariantSchema.parse(req.body ?? {});
    const created = await partCatalogChildrenService.createVariant(parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE), data);
    return res.status(201).json(created);
  } catch (err) {
    return failWith(err, req, next, "Échec de la création de la variante");
  }
});

router.patch("/parts/:id/variants/:variantId", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    const data = updatePartVariantSchema.parse(req.body ?? {});
    const updated = await partCatalogChildrenService.updateVariant(
      parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE),
      parseRouteId(req.params.variantId, VARIANT_ID_INVALID_MESSAGE),
      data,
    );
    return res.json(updated);
  } catch (err) {
    return failWith(err, req, next, "Échec de la modification de la variante");
  }
});

router.delete("/parts/:id/variants/:variantId", authenticate, isPartsCatalogManager, async (req, res, next) => {
  try {
    await partCatalogChildrenService.deleteVariant(
      parseRouteId(req.params.id, PART_ID_INVALID_MESSAGE),
      parseRouteId(req.params.variantId, VARIANT_ID_INVALID_MESSAGE),
    );
    return res.status(204).send();
  } catch (err) {
    return failWith(err, req, next, "Échec de la suppression de la variante");
  }
});

export default router;
