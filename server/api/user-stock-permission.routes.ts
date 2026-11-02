import { Router, type RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authenticate, isAdmin } from "../middleware/auth";

const log = moduleLogger("user-stock-permission");

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const bodySchema = z.object({
  canIssueStock: z.boolean({
    errorMap: () => ({ message: "Valeur invalide : indiquez si le droit de sortie est accordé (oui ou non)." }),
  }),
});

/**
 * Droit de sortie de stock du chef d'atelier (dérogation « magasin fermé »).
 * Accordé par défaut ; l'administrateur seul le retire ou le rend. Les autres
 * rôles n'ont pas ce réglage : le magasinier sort de plein droit, le technicien
 * jamais.
 */
export const patchStockIssuePermission: RequestHandler = async (req, res, next) => {
  try {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) throw new AppError(400, "Utilisateur invalide");
    const body = bodySchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, body.error.issues[0]?.message ?? "Requête invalide");

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, params.data.id), isNull(users.deletedAt)));
    if (!target) throw new AppError(404, "Utilisateur introuvable");
    if (target.role !== "workshop_manager") {
      throw new AppError(400, "Ce réglage ne concerne que les chefs d'atelier.");
    }

    const [updated] = await db
      .update(users)
      .set({ canIssueStock: body.data.canIssueStock })
      .where(eq(users.id, target.id))
      .returning({ id: users.id, role: users.role, canIssueStock: users.canIssueStock });

    log.info(
      { requestId: req.requestId, adminId: req.user?.id, userId: target.id, canIssueStock: updated.canIssueStock },
      "droit de sortie de stock modifié",
    );
    return res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.patch("/users/:id/stock-issue-permission", authenticate, isAdmin, patchStockIssuePermission);

export default router;
