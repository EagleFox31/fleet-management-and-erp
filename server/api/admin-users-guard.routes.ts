import { Router } from "express";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { authenticate, isAdmin } from "../middleware/auth";

const router = Router();

/**
 * Un admin ne se désactive pas lui-même : sans cette garde, il pouvait se
 * verrouiller hors de l'application (et perdre sa session). Garde seule : la
 * route d'activation vit dans server/routes.ts (gelé) et prend le relais par
 * `next()` pour tout autre cas.
 *
 * L'id est lu strictement : la route aval lit `parseInt(req.params.id)` sans base, qui comprend « 0x1 »
 * comme 1 alors que `parseInt(…, 10)` y lit 0. Une garde qui lit autrement que la route qu'elle protège
 * se laisse contourner ; tout id qui n'est pas des chiffres purs est donc refusé ici, avant la route.
 */
router.patch("/admin/users/:id/toggle", authenticate, isAdmin, (req, _res, next) => {
  const id = parseRouteId(req.params.id, "Identifiant d'utilisateur invalide.");
  const wantsActive = req.body?.isActive;
  if (id === req.session.userId && !wantsActive) {
    return next(new AppError(400, "Vous ne pouvez pas désactiver votre propre compte"));
  }
  return next();
});

export default router;
