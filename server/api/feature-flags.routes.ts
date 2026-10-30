import { Router } from "express";
import { featureFlagsResponseSchema } from "@shared/feature-flags";
import { getFeatureFlags } from "../lib/feature-flags";
import { isAnyUser } from "../middleware/auth";

const router = Router();

/** GET /api/feature-flags : valeurs effectives, lisibles par tous les rôles (le client masque l'interface). */
router.get("/feature-flags", isAnyUser, (_req, res) => {
  res.status(200).json(featureFlagsResponseSchema.parse(getFeatureFlags()));
});

export default router;
