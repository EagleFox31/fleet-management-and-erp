import { Router } from "express";
import {
  authenticate,
  isInventoryManager,
  isPartRequester,
  isWorkshopManager,
} from "../middleware/auth";
import { partRequirementsService } from "../services/part-requirements-service";
import { PartRequirementWorkflow } from "../services/part-requirements-workflow";
import { insertPartRequirementSchema } from "@shared/schema";
import { ZodError } from "zod";
import { moduleLogger } from "../lib/logger";
import { isAppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { workOrderCostScope, workOrderStaffScope } from "../lib/work-order-realtime-scope";

const log = moduleLogger("part-requirements-routes");
const router = Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const requirements = await partRequirementsService.getPartRequirements(status);
    return res.status(200).json(requirements);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get part requirements error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/active-by-part", authenticate, async (req, res) => {
  try {
    const activeByPart = await partRequirementsService.getActiveRequirementsByPart();
    const result: Record<number, { status: string; urgency: string; count: number }> = {};
    activeByPart.forEach((value, key) => {
      result[key] = value;
    });
    return res.status(200).json(result);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get active requirements by part error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/by-part/:partId", authenticate, async (req, res, next) => {
  try {
    const partId = parseRouteId(req.params.partId, "Identifiant de pièce invalide.");
    const requirements = await partRequirementsService.getRequirementsByPartId(partId);
    return res.status(200).json(requirements);
  } catch (error) {
    if (isAppError(error)) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Get requirements by part error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/workflow/statuses", authenticate, async (req, res) => {
  try {
    const currentStatus = req.query.current as string;
    const userRole = req.user?.role || "technician";

    if (currentStatus) {
      const nextStatuses = PartRequirementWorkflow.getNextPossibleStatuses(
        currentStatus as any,
        userRole
      );
      return res.json({
        current: PartRequirementWorkflow.getStatusInfo(currentStatus as any),
        nextPossible: nextStatuses.map((status) => PartRequirementWorkflow.getStatusInfo(status)),
      });
    }

    const allStatuses = [
      "pending",
      "approved",
      "ordered",
      "partial",
      "delivered",
      "fulfilled",
      "cancelled",
    ];
    return res.json({
      all: allStatuses.map((status) => PartRequirementWorkflow.getStatusInfo(status as any)),
    });
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get workflow statuses error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/", isPartRequester, async (req, res, next) => {
  try {
    const userId = req.user?.id;

    // Sans validation, un corps incomplet atteignait la base et revenait en 500.
    // Statut et date de livraison sont tenus par le workflow (T4) : une
    // demande naît toujours en attente, jamais déjà reçue ou sortie.
    const requirement = await partRequirementsService.createPartRequirement({
      ...insertPartRequirementSchema.parse({ ...req.body, requestedBy: userId }),
      status: "pending",
      actualDeliveryDate: null,
    });

    if ((global as any).broadcastUpdate) {
      (global as any).broadcastUpdate("part_requirement_created", {
        scope: workOrderCostScope(),
        requirementId: requirement.id,
        workOrderId: requirement.workOrderId ?? null,
        partId: requirement.partId ?? null,
        status: requirement.status,
        requirement,
        actor: req.user
          ? {
              userId: req.user.id,
              role: req.user.role,
              username: req.user.username,
            }
          : null,
      });
    }

    return res.status(201).json(requirement);
  } catch (error) {
    if (error instanceof ZodError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Create part requirement error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.patch("/:id", isInventoryManager, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de demande invalide.");
    // Champs tenus par le serveur : jamais repris du corps (T4).
    const {
      emergencyOverrideReason,
      id: _id,
      requestedBy: _requestedBy,
      receivedBy: _receivedBy,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...requirementPayload
    } = req.body ?? {};

    if (isNaN(id)) {
      return res.status(400).json({ message: "ID de demande invalide" });
    }

    const requirement = await partRequirementsService.getPartRequirement(id);

    if (!requirement) {
      return res.status(404).json({ message: "Demande non trouvée" });
    }

    const userRole = req.user?.role || "technician";
    const currentUserId = req.user?.id;

    const result = await partRequirementsService.updatePartRequirement(
      id,
      requirementPayload,
      userRole,
      currentUserId,
      {
        emergencyOverrideReason:
          typeof emergencyOverrideReason === "string" ? emergencyOverrideReason : undefined,
      }
    );

    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }

    if ((global as any).broadcastUpdate && result.data) {
      (global as any).broadcastUpdate("part_requirement_updated", {
        scope: workOrderCostScope(),
        requirementId: result.data.id,
        workOrderId: result.data.workOrderId ?? null,
        partId: result.data.partId ?? null,
        status: result.data.status,
        requirement: result.data,
        actor: req.user
          ? {
              userId: req.user.id,
              role: req.user.role,
              username: req.user.username,
            }
          : null,
      });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    if (isAppError(error)) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Update part requirement error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.delete("/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Identifiant de demande invalide.");

    const requirement = await partRequirementsService.getPartRequirement(id);

    if (!requirement) {
      return res.status(404).json({ message: "Demande non trouvée" });
    }

    await partRequirementsService.deletePartRequirement(id);

    if ((global as any).broadcastUpdate) {
      (global as any).broadcastUpdate("part_requirement_deleted", {
        scope: workOrderStaffScope(),
        requirementId: requirement.id,
        workOrderId: requirement.workOrderId ?? null,
        partId: requirement.partId ?? null,
        status: requirement.status,
        actor: req.user
          ? {
              userId: req.user.id,
              role: req.user.role,
              username: req.user.username,
            }
          : null,
      });
    }

    return res.status(204).send();
  } catch (error) {
    if (isAppError(error)) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Delete part requirement error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
