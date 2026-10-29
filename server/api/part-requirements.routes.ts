import { Router } from "express";
import {
  authenticate,
  isInventoryManager,
  isPartRequester,
  isWorkshopManager,
} from "../middleware/auth";
import { partRequirementsService } from "../services/part-requirements-service";
import { PartRequirementWorkflow } from "../services/part-requirements-workflow";

const router = Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const requirements = await partRequirementsService.getPartRequirements(status);
    return res.status(200).json(requirements);
  } catch (error) {
    console.error("Get part requirements error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/active-by-part", authenticate, async (_req, res) => {
  try {
    const activeByPart = await partRequirementsService.getActiveRequirementsByPart();
    const result: Record<number, { status: string; urgency: string; count: number }> = {};
    activeByPart.forEach((value, key) => {
      result[key] = value;
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Get active requirements by part error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/by-part/:partId", authenticate, async (req, res) => {
  try {
    const partId = parseInt(req.params.partId);
    if (isNaN(partId)) {
      return res.status(400).json({ message: "ID de pièce invalide" });
    }
    const requirements = await partRequirementsService.getRequirementsByPartId(partId);
    return res.status(200).json(requirements);
  } catch (error) {
    console.error("Get requirements by part error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/workflow/statuses", authenticate, async (req, res) => {
  try {
    const currentStatus = req.query.current as string;
    const userRole = req.session?.role || req.user?.role || "technician";

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
    console.error("Get workflow statuses error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/", isPartRequester, async (req, res) => {
  try {
    const userId = req.user?.id;

    const requirement = await partRequirementsService.createPartRequirement({
      ...req.body,
      requestedBy: userId,
    });

    if ((global as any).broadcastUpdate) {
      (global as any).broadcastUpdate("part_requirement_created", {
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
    console.error("Create part requirement error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.patch("/:id", isInventoryManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Champs tenus par le serveur : jamais repris du corps (T4).
    const {
      emergencyOverrideReason,
      id: _id,
      requestedBy: _requestedBy,
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

    const userRole = req.user?.role || req.session?.role || "technician";
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
    console.error("Update part requirement error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.delete("/:id", isWorkshopManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ message: "ID de demande invalide" });
    }

    const requirement = await partRequirementsService.getPartRequirement(id);

    if (!requirement) {
      return res.status(404).json({ message: "Demande non trouvée" });
    }

    await partRequirementsService.deletePartRequirement(id);

    if ((global as any).broadcastUpdate) {
      (global as any).broadcastUpdate("part_requirement_deleted", {
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
    console.error("Delete part requirement error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
