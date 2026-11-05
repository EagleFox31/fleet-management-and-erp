import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "../../shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { assertNotLastActiveAdmin, SELF_ADMIN_ROLE_MESSAGE } from "../lib/last-admin";
import { moduleLogger } from "../lib/logger";
import { parseRouteId } from "../lib/route-id";
import { authenticate, isAdmin } from "../middleware/auth";

const log = moduleLogger("last-admin-guard");
const router = Router();

/** Id invalide ou compte inconnu : la route gelée de `server/routes.ts` répond (404 / 400). */
async function activeAdminTarget(id: number): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));
  return row?.role === "admin";
}

function failWith(err: unknown, req: Request, next: NextFunction): void {
  if (err instanceof AppError) return next(err);
  log.error({ err, requestId: req.requestId }, "Garde du dernier administrateur en échec");
  return next(new AppError(500, "Erreur serveur", { cause: err }));
}

/**
 * Garde du dernier administrateur actif. Les routes d'écriture vivent dans `server/routes.ts`
 * (gelé) : ce routeur, monté avant, ne fait que le contrôle puis prend le relais par `next()`.
 */
router.patch("/users/:id", authenticate, isAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant d'utilisateur invalide.");
    const role = req.body?.role;
    if (typeof role !== "string" || role === "admin") return next();
    if (!(await activeAdminTarget(id))) return next();
    if (id === req.user!.id) throw new AppError(400, SELF_ADMIN_ROLE_MESSAGE);
    await assertNotLastActiveAdmin(res, id);
    return next();
  } catch (err) {
    return failWith(err, req, next);
  }
});

async function guardRemoval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseRouteId(req.params.id, "Identifiant d'utilisateur invalide.");
    if (!(await activeAdminTarget(id))) return next();
    await assertNotLastActiveAdmin(res, id);
    return next();
  } catch (err) {
    return failWith(err, req, next);
  }
}

/** Désactivation (`isActive: false`) : même effet qu'une suppression pour le décompte des admins actifs. */
router.patch("/admin/users/:id/toggle", authenticate, isAdmin, async (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.isActive !== false) return next();
  // Se désactiver soi-même est déjà refusé par `admin-users-guard`, monté avant ce routeur.
  return guardRemoval(req, res, next);
});

router.delete("/users/:id", authenticate, isAdmin, guardRemoval);
router.delete("/admin/users/:id", authenticate, isAdmin, guardRemoval);

export default router;
