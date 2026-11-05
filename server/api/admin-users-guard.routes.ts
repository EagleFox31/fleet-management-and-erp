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
 */
router.patch("/admin/users/:id/toggle", authenticate, isAdmin, (req, _res, next) => {
  // Lecture stricte : `<id>abc` viserait <id> par `parseInt`, et la route de `server/routes.ts` qui prend le relais
  // lit l'id de façon lâche. Refuser ici évite de désactiver un autre compte que celui visé.
  const id = parseRouteId(req.params.id, "Identifiant d'utilisateur invalide.");
  const wantsActive = req.body?.isActive;
  if (id === req.session.userId && !wantsActive) {
    return next(new AppError(400, "Vous ne pouvez pas désactiver votre propre compte"));
  }
  return next();
});

export default router;
