import { Router } from "express";
import { z } from "zod";
import { idSchema } from "@shared/contracts/common";
import { parseRouteId } from "../lib/route-id";
import { MISSION_OPERATIONS_READ_ROLES, MISSION_OPERATIONS_WRITE_ROLES } from "@shared/constants/roles";
import { missionOperationBodySchema } from "@shared/contracts/mission-operations";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { listMissionOperations, upsertMissionOperation } from "../services/mission-operations-service";

const router = Router();

/** Corps strict : aucun champ serveur (createdBy, updatedBy, missionId) n'est accepté. */
const putBodySchema = z.object(missionOperationBodySchema.shape).strict();

const querySchema = z.object({
  clientId: idSchema.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

/** Suivi des opérations clients : une ligne par mission, récapitulatif en 5 statuts. */
router.get(
  "/mission-operations",
  requireFeature("operations-tracking"),
  authorize([...MISSION_OPERATIONS_READ_ROLES]),
  async (req, res, next) => {
    try {
      const query = querySchema.safeParse(req.query);
      if (!query.success) throw new AppError(400, "Filtre invalide.");
      res.json(await listMissionOperations(query.data));
    } catch (err) {
      next(err);
    }
  },
);

/** Saisie du suivi d'une mission : création ou mise à jour (rejouable). */
router.put(
  "/mission-operations/:missionId",
  requireFeature("operations-tracking"),
  authorize([...MISSION_OPERATIONS_WRITE_ROLES]),
  async (req, res, next) => {
    try {
      const missionId = parseRouteId(req.params.missionId, "Données de suivi invalides.");
      const body = putBodySchema.safeParse(req.body);
      if (!body.success) throw new AppError(400, "Données de suivi invalides.");
      const userId = (req as unknown as { user: { id: number } }).user.id;
      res.json(await upsertMissionOperation(missionId, body.data, userId));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
