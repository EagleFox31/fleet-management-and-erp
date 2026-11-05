import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { insertTireRotationSchema, users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { MAX_DB_INTEGER_ID } from "../lib/route-id";
import { isWorkshopManager } from "../middleware/auth";
import { tiresService } from "../services/tires-service-simplified";

const router = Router();

const TECHNICIAN_NOT_FOUND = "Technicien introuvable : choisissez un technicien de la liste.";

// OT et auteur sont posés par le serveur ; le formulaire envoie le coût en nombre.
const rotationInput = insertTireRotationSchema
  .omit({ workOrderId: true, performedBy: true, createdBy: true })
  .extend({
    cost: z.coerce.number().nonnegative().nullish(),
    technicianId: z.number().int().positive().max(MAX_DB_INTEGER_ID, TECHNICIAN_NOT_FOUND).nullish(),
  });

/**
 * Le technicien facultatif devient celui de l'OT créé avec la rotation. Un id hors de la plage
 * `integer` ou sans utilisateur échouerait en base (500) : refus lisible avant toute écriture.
 * Existence seulement, pas de contrôle de rôle (même règle que `work-order-items-service`).
 */
async function assertTechnicianExists(technicianId: number | null | undefined): Promise<void> {
  if (technicianId === null || technicianId === undefined) return;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, technicianId)).limit(1);
  if (!user) throw new AppError(400, TECHNICIAN_NOT_FOUND);
}

/** Planifier une rotation de pneus : crée l'OT préventif et la rotation. Déplacée de server/routes.ts (gelé). */
router.post("/tire-rotations", isWorkshopManager, async (req, res, next) => {
  try {
    const input = rotationInput.parse(req.body?.rotation ?? {});
    await assertTechnicianExists(input.technicianId);
    const result = await tiresService.createTireRotation({ ...input, performedBy: req.user?.id });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
