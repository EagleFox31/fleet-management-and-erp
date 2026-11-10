import { Router } from "express";
import { z } from "zod";
import { parseRouteId } from "../lib/route-id";
import { TARIFF_GRID_READ_ROLES, TARIFF_GRID_WRITE_ROLES } from "@shared/constants/roles";
import { tariffBodyShape, tariffListQuerySchema, tariffSuggestQuerySchema } from "@shared/contracts/tariff-grid";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { createTariff, deactivateTariff, listTariffPage, suggestTariff, updateTariff } from "../services/tariff-grid-service";

const router = Router();

/** Corps strict : aucun champ serveur (id, createdBy, updatedBy, horodatages) n'est accepté. */
const bodySchema = z.object(tariffBodyShape).strict();

const userIdOf = (req: unknown) => (req as { user: { id: number } }).user.id;

router.get("/tariff-grid", requireFeature("pricing"), authorize([...TARIFF_GRID_READ_ROLES]), async (req, res, next) => {
  try {
    const query = tariffListQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(400, "Filtre invalide.");
    res.json(
      await listTariffPage(
        { clientId: query.data.clientId, activeOnly: query.data.activeOnly === "true" },
        { limit: query.data.limit, offset: query.data.offset },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/** Suggestion de prix : lecture seule, ne modifie ni la mission ni la facture. */
router.get("/tariff-grid/suggest", requireFeature("pricing"), authorize([...TARIFF_GRID_READ_ROLES]), async (req, res, next) => {
  try {
    const query = tariffSuggestQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(400, "Paramètres de suggestion invalides.");
    res.json(await suggestTariff(query.data));
  } catch (err) {
    next(err);
  }
});

router.post("/tariff-grid", requireFeature("pricing"), authorize([...TARIFF_GRID_WRITE_ROLES]), async (req, res, next) => {
  try {
    const body = bodySchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, "Données de tarif invalides.");
    res.status(201).json(await createTariff(body.data, userIdOf(req)));
  } catch (err) {
    next(err);
  }
});

router.put("/tariff-grid/:id", requireFeature("pricing"), authorize([...TARIFF_GRID_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Données de tarif invalides.");
    const body = bodySchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, "Données de tarif invalides.");
    res.json(await updateTariff(id, body.data, userIdOf(req)));
  } catch (err) {
    next(err);
  }
});

/** Désactive le tarif (historique conservé). */
router.delete("/tariff-grid/:id", requireFeature("pricing"), authorize([...TARIFF_GRID_WRITE_ROLES]), async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Tarif invalide.");
    res.json(await deactivateTariff(id, userIdOf(req)));
  } catch (err) {
    next(err);
  }
});

export default router;
