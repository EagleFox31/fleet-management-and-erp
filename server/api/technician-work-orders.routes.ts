import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  TECHNICIAN_TARGET_STATUSES,
  canTechnicianTransition,
} from "@shared/constants/technician-work-order-transitions";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authenticate } from "../middleware/auth";
import { alertService } from "../services/alert-service";
import { storage } from "../storage";

const log = moduleLogger("technician-work-orders");

const STATUS_LABELS: Record<string, string> = {
  pending: "en attente",
  in_progress: "en cours",
  awaiting_parts: "en attente de pièces",
  completed: "terminé",
  cancelled: "annulé",
};

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const bodySchema = z.object({
  status: z.enum(TECHNICIAN_TARGET_STATUSES, {
    errorMap: () => ({ message: "Statut invalide : choisissez « en cours » ou « terminé »." }),
  }),
  notes: z.string().trim().max(5000).optional(),
  mileageUpdate: z.number().int().positive("Le kilométrage doit être un nombre positif.").optional(),
  // Ancien champ de l'écran : le technicien ne sort plus de pièce lui-même.
  partsUsed: z.unknown().optional(),
});

/**
 * Mise à jour d'un OT par son technicien : statut, diagnostic, kilométrage.
 * Les pièces ne passent jamais par ici : le technicien les demande pendant la
 * réparation et le magasinier les sort du stock.
 * Tout est vérifié avant la première écriture.
 */
const patchTechnicianWorkOrderStatus: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (typeof userId !== "number") throw new AppError(401, "Non authentifié");

    const user = await storage.getUser(userId);
    if (!user || user.role !== "technician") {
      throw new AppError(403, "Accès réservé aux techniciens");
    }

    const { id: workOrderId } = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body ?? {});

    if (body.partsUsed !== undefined && !(Array.isArray(body.partsUsed) && body.partsUsed.length === 0)) {
      throw new AppError(
        400,
        "Les pièces ne s'ajoutent plus ici : demandez-les depuis la fiche de l'ordre de travail, le magasin les sortira du stock.",
      );
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) throw new AppError(404, "Ordre de travail non trouvé");
    if (workOrder.technicianId !== userId) {
      throw new AppError(403, "Ordre de travail non assigné à ce technicien");
    }

    if (!canTechnicianTransition(workOrder.status, body.status)) {
      throw new AppError(
        409,
        `Un ordre de travail ${STATUS_LABELS[workOrder.status] ?? workOrder.status} ne peut pas passer « ${STATUS_LABELS[body.status]} ».`,
      );
    }

    let mileageToWrite: { mileage: number; lastMileage: number } | null = null;
    if (body.mileageUpdate !== undefined) {
      const vehicle = await storage.getVehicle(workOrder.vehicleId);
      const current = Number(vehicle?.mileage ?? 0);
      if (body.mileageUpdate < current) {
        throw new AppError(
          400,
          `Le kilométrage saisi (${body.mileageUpdate.toLocaleString("fr-FR")} km) est inférieur au kilométrage actuel du véhicule (${current.toLocaleString("fr-FR")} km).`,
        );
      }
      if (body.mileageUpdate > current) {
        mileageToWrite = { mileage: body.mileageUpdate, lastMileage: current };
      }
    }

    const updateData: { status: string; diagnosis?: string; startDate?: Date; endDate?: Date } = { status: body.status };
    if (body.notes) updateData.diagnosis = body.notes;
    if (body.status === "in_progress" && !workOrder.startDate) updateData.startDate = new Date();
    if (body.status === "completed") updateData.endDate = new Date();

    const updatedOrder = await storage.updateWorkOrder(workOrderId, updateData as never);
    if (mileageToWrite) await storage.updateVehicle(workOrder.vehicleId, mileageToWrite);

    // Avancement vers l'encadrement : le chef d'atelier est prévenu du démarrage ou de la fin,
    // comme pour PATCH /api/work-orders/:id. Une alerte non envoyée ne fait pas échouer le geste.
    if (body.status !== workOrder.status && (body.status === "in_progress" || body.status === "completed")) {
      const vehicle = workOrder.vehicleId ? await storage.getVehicle(workOrder.vehicleId).catch(() => undefined) : undefined;
      alertService
        .notifyWorkOrderProgress({
          workOrderId,
          workOrderTitle: updatedOrder?.title || workOrder.title,
          newStatus: body.status,
          technicianName: user.name ?? null,
          vehicleRegistration: vehicle?.registrationNumber ?? null,
          excludeUserId: userId,
        })
        .catch((error) => {
          log.error({ err: error, workOrderId, requestId: req.requestId }, "alerte d'avancement non envoyée");
        });
    }

    const broadcast = (global as any).broadcastUpdate;
    if (typeof broadcast === "function") {
      broadcast("work_order_updated", {
        scope: { type: "broadcast" },
        workOrderId,
        updates: updateData,
        workOrder: updatedOrder,
        source: "technician_work_order_update",
        triggeredBy: userId,
        actor: { userId, role: user.role, username: user.username },
      });
    }

    log.info(
      { workOrderId, from: workOrder.status, to: body.status, mileage: mileageToWrite?.mileage, userId, requestId: req.requestId },
      "statut d'OT mis à jour par le technicien",
    );
    res.status(200).json(updatedOrder);
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.patch("/technician/work-orders/:id/status", authenticate, patchTechnicianWorkOrderStatus);

export default router;
