import { Router } from "express";
import { z } from "zod";
import { insertTireRotationSchema } from "@shared/schema";
import { MAX_DB_INTEGER_ID } from "../lib/route-id";
import { isWorkshopManager } from "../middleware/auth";
import { tiresService } from "../services/tires-service-simplified";
import { assertWorkOrderAssignee } from "../services/work-order-assignee";

const router = Router();

const TECHNICIAN_NOT_FOUND = "Technicien introuvable : choisissez un technicien de la liste.";

// OT et auteur sont posés par le serveur ; le formulaire envoie le coût en nombre.
const rotationInput = insertTireRotationSchema
  .omit({ workOrderId: true, performedBy: true, createdBy: true })
  .extend({
    cost: z.coerce.number().nonnegative().nullish(),
    technicianId: z.number().int().positive().max(MAX_DB_INTEGER_ID, TECHNICIAN_NOT_FOUND).nullish(),
  });

/** Planifier une rotation de pneus : crée l'OT préventif et la rotation. Déplacée de server/routes.ts (gelé). */
router.post("/tire-rotations", isWorkshopManager, async (req, res, next) => {
  try {
    const input = rotationInput.parse(req.body?.rotation ?? {});
    // Le technicien facultatif devient celui de l'OT créé : même cible que toute affectation d'OT.
    await assertWorkOrderAssignee(input.technicianId);
    const result = await tiresService.createTireRotation({ ...input, performedBy: req.user?.id });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
