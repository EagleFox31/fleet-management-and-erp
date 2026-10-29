import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { authenticate, isTechnician, isStockIssuer } from "../middleware/auth";
import {
  getPartRequirementStatusLabel,
  getPartRequirementProgressLabel,
} from "@shared/constants/part-requirements";
import { storage } from "../storage";
import { partRequirementsService, STALE_STATUS_ERROR } from "../services/part-requirements-service";
import { isAppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("work-order-parts");
import { partRequirements, parts, users } from "@shared/schema";
import { alertService } from "../services/alert-service";

const router = Router();

const openRequirementStatuses: Array<
  "pending" | "approved" | "ordered" | "partially_received" | "received" | "partial" | "delivered"
> = ["pending", "approved", "ordered", "partially_received", "received", "partial", "delivered"];

router.get("/:workOrderId/pending-part-requirements", authenticate, async (req, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);

    if (isNaN(workOrderId)) {
      return res.status(400).json({ message: "ID d'ordre de travail invalide" });
    }

    const requirements = await db
      .select({
        id: partRequirements.id,
        partId: partRequirements.partId,
        quantityNeeded: partRequirements.quantityNeeded,
        status: partRequirements.status,
        urgency: partRequirements.urgency,
        reason: partRequirements.reason,
        estimatedCost: partRequirements.estimatedCost,
        createdAt: partRequirements.createdAt,
        updatedAt: partRequirements.updatedAt,
        notes: partRequirements.notes,
        partName: parts.name,
        partReference: parts.reference,
        partUnitPrice: parts.unitPrice,
        currentStock: parts.quantity,
        minStock: parts.minQuantity,
        // Sert à nommer qui doit valider: un chef d'atelier ne s'auto-approuve
        // pas, c'est la secrétaire qui tranche.
        requesterRole: users.role,
      })
      .from(partRequirements)
      .leftJoin(parts, eq(partRequirements.partId, parts.id))
      .leftJoin(users, eq(partRequirements.requestedBy, users.id))
      .where(
        and(
          eq(partRequirements.workOrderId, workOrderId),
          inArray(partRequirements.status, openRequirementStatuses)
        )
      )
      .orderBy(desc(partRequirements.updatedAt), desc(partRequirements.createdAt));

    const response = requirements.map((requirement) => {
      const quantityNeeded = Number(requirement.quantityNeeded || 0);
      const stockAvailable = Number(requirement.currentStock || 0);
      const unitPrice = Number.parseFloat(requirement.partUnitPrice || "0");
      const estimatedCost = requirement.estimatedCost
        ? Number.parseFloat(requirement.estimatedCost)
        : unitPrice * quantityNeeded;

      // Deux conditions pour sortir une pièce: la demande doit être reçue au
      // magasin, et le stock doit suivre. Du stock ne sert à rien si la pièce
      // n'a pas encore suivi le circuit.
      const stockSuffisant = stockAvailable >= quantityNeeded && quantityNeeded > 0;
      const recueAuMagasin = requirement.status === "received";

      // Une seule phrase d'avancement, calculée ici, affichée telle quelle.
      // Le technicien lit ce qu'on attend; le magasinier lit s'il peut sortir.
      const stockManquant = recueAuMagasin && !stockSuffisant;
      const progressLabel = stockManquant
        ? "Stock insuffisant au magasin"
        : getPartRequirementProgressLabel(requirement.status, requirement.requesterRole);

      return {
        ...requirement,
        stockAvailable,
        unitPrice,
        estimatedCost,
        shortage: Math.max(0, quantityNeeded - stockAvailable),
        canBeIssued: recueAuMagasin && stockSuffisant,
        progressLabel,
        // true = anomalie à traiter (rouge), false = attente normale (gris).
        progressBlocking: stockManquant,
      };
    });

    return res.status(200).json(response);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get pending part requirements for work order error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/:workOrderId/awaiting-parts", isTechnician, async (req, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const user = req.user;

    if (isNaN(workOrderId)) {
      return res.status(400).json({ message: "ID d'ordre de travail invalide" });
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ message: "Ordre de travail non trouvé" });
    }

    if (user?.role === "technician" && workOrder.technicianId && workOrder.technicianId !== user.id) {
      return res.status(403).json({ message: "Accès refusé - OT assignée à un autre technicien" });
    }

    if (workOrder.status === "completed" || workOrder.status === "cancelled") {
      return res.status(400).json({ message: "Impossible de modifier une OT terminée ou annulée" });
    }

    const requestedPartId = Number(req.body?.partId);
    const requestedQty = Number(req.body?.quantityNeeded ?? req.body?.quantity);
    const hasPartPayload = Number.isFinite(requestedPartId) && requestedPartId > 0;
    log.info(
      `[AWAITING_PARTS] OT #${workOrderId} - actor=${user?.username ?? "unknown"} role=${user?.role ?? "unknown"} partId=${hasPartPayload ? requestedPartId : "none"} qty=${Number.isFinite(requestedQty) ? requestedQty : "n/a"}`
    );

    let linkedRequirement: Awaited<ReturnType<typeof storage.getPartRequirement>> | null = null;
    let usedExistingRequirement = false;

    if (hasPartPayload) {
      const partId = requestedPartId;
      const quantityNeeded = Number.isFinite(requestedQty) && requestedQty > 0 ? Math.floor(requestedQty) : 1;
      const part = await storage.getPart(partId);

      if (!part) {
        return res.status(404).json({ message: "Pièce introuvable" });
      }

      const [existingForWorkOrder] = await db
        .select({ id: partRequirements.id })
        .from(partRequirements)
        .where(
          and(
            eq(partRequirements.workOrderId, workOrderId),
            eq(partRequirements.partId, partId),
            inArray(partRequirements.status, openRequirementStatuses)
          )
        )
        .orderBy(desc(partRequirements.updatedAt), desc(partRequirements.createdAt))
        .limit(1);

      if (existingForWorkOrder) {
        linkedRequirement = await storage.getPartRequirement(existingForWorkOrder.id);
        usedExistingRequirement = true;
        log.info(`[AWAITING_PARTS] Demande existante réutilisée #${existingForWorkOrder.id} pour OT #${workOrderId}`);
      } else {
        const urgencyFromBody = typeof req.body?.urgency === "string" ? req.body.urgency : null;
        const urgency =
          urgencyFromBody === "low" ||
          urgencyFromBody === "medium" ||
          urgencyFromBody === "high" ||
          urgencyFromBody === "critical"
            ? urgencyFromBody
            : "high";

        const reasonFromBody = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
        const workOrderLabel = workOrder.title
          ? `OT #${workOrderId} - ${workOrder.title}`
          : `OT #${workOrderId}`;
        const reason =
          reasonFromBody ||
          `${workOrderLabel} • Besoin pièce: ${part.name} (${part.reference || "sans-référence"})`;

        const createdRequirement = await partRequirementsService.createPartRequirement({
          partId,
          workOrderId,
          vehicleId: workOrder.vehicleId ?? null,
          quantityNeeded,
          urgency,
          reason,
          status: "pending",
          requestedBy: user?.id ?? 1,
          notes:
            `Créée automatiquement depuis l'OT #${workOrderId} lors du passage en attente de pièces ` +
            `(besoin: ${quantityNeeded}, stock actuel: ${Number(part.quantity || 0)}).`,
        });
        linkedRequirement = await storage.getPartRequirement(createdRequirement.id);
        log.info(`[AWAITING_PARTS] Nouvelle demande créée #${createdRequirement.id} pour OT #${workOrderId}`);
      }
    }

    const statusWasChanged = workOrder.status !== "awaiting_parts";
    const updatedWorkOrder = statusWasChanged
      ? await storage.updateWorkOrder(workOrderId, { status: "awaiting_parts" })
      : workOrder;

    if ((global as any).broadcastUpdate) {
      if (statusWasChanged) {
        (global as any).broadcastUpdate("work_order_updated", {
          workOrderId,
          updates: { status: "awaiting_parts" },
          workOrder: updatedWorkOrder,
          source: "manual_awaiting_parts",
          triggeredBy: user?.id ?? null,
          actor: user
            ? {
                userId: user.id,
                role: user.role,
                username: user.username,
              }
            : null,
        });
      }

      if (linkedRequirement?.id) {
        (global as any).broadcastUpdate(
          usedExistingRequirement ? "part_requirement_updated" : "part_requirement_created",
          {
          requirementId: linkedRequirement.id,
          workOrderId,
          partId: linkedRequirement.partId ?? null,
          status: linkedRequirement.status,
          requirement: linkedRequirement,
          source: usedExistingRequirement ? "existing_requirement_reused" : "requirement_auto_created",
          actor: user
            ? {
                userId: user.id,
                role: user.role,
                username: user.username,
              }
            : null,
        });
      }
    }

    return res.status(200).json({
      workOrder: updatedWorkOrder,
      requirement: linkedRequirement,
      usedExistingRequirement,
      statusWasChanged,
      message: usedExistingRequirement
        ? "OT en attente de pièces. Demande existante réutilisée."
        : linkedRequirement
          ? "OT en attente de pièces. Demande de pièce créée."
          : "OT en attente de pièces.",
    });
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Mark work order as awaiting parts error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/:workOrderId/part-requirements/:requirementId/issue", isStockIssuer, async (req, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const requirementId = parseInt(req.params.requirementId);
    const user = req.user;

    if (isNaN(workOrderId) || isNaN(requirementId)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ message: "Ordre de travail non trouvé" });
    }

    // Pas de contrôle « OT assignée à moi » ici, volontairement: `isStockIssuer`
    // n'admet que magasin, admin et chef d'atelier — aucun n'est propriétaire
    // d'une OT. Le contrôle d'appartenance vit sur la route `awaiting-parts`,
    // celle qu'emprunte le technicien.

    if (workOrder.status === "completed" || workOrder.status === "cancelled") {
      return res.status(400).json({ message: "Impossible de modifier une OT terminée ou annulée" });
    }

    const requirement = await storage.getPartRequirement(requirementId);
    if (!requirement) {
      return res.status(404).json({ message: "Demande de pièce introuvable" });
    }

    if (requirement.workOrderId !== workOrderId) {
      return res.status(400).json({ message: "Cette demande n'est pas liée à cette OT" });
    }

    if (!requirement.partId) {
      return res.status(400).json({ message: "La demande n'est pas liée à une pièce valide" });
    }

    if (["issued", "fulfilled", "cancelled", "rejected"].includes(requirement.status)) {
      return res.status(400).json({ message: "Cette demande est déjà finalisée" });
    }

    // La pièce doit avoir été reçue au magasin avant d'en sortir.
    // Sans ce contrôle, une demande encore `pending` basculait directement en
    // `issued`: le stock baissait sans approbation ni réception, et tout le
    // circuit défini dans `part-requirements-workflow` était court-circuité.
    if (requirement.status !== "received") {
      return res.status(400).json({
        message:
          `Cette pièce doit d'abord être reçue au magasin. ` +
          `Statut actuel: ${getPartRequirementStatusLabel(requirement.status)}.`,
      });
    }

    const part = await storage.getPart(requirement.partId);
    if (!part) {
      return res.status(404).json({ message: "Pièce introuvable" });
    }

    const quantityNeeded = Number(requirement.quantityNeeded || 0);
    const stockAvailable = Number(part.quantity || 0);
    if (quantityNeeded <= 0) {
      return res.status(400).json({ message: "Quantité demandée invalide" });
    }

    if (stockAvailable < quantityNeeded) {
      return res.status(400).json({
        message: `Stock insuffisant. Disponible: ${stockAvailable}, requis: ${quantityNeeded}`,
        stockAvailable,
        quantityNeeded,
      });
    }

    const unitPrice = part.unitPrice ? String(part.unitPrice) : "0";
    const partId = requirement.partId;
    let partUsed: Awaited<ReturnType<typeof storage.addPartToWorkOrder>> | null = null;

    const nowIso = new Date().toISOString();
    const auditLine = `[${nowIso}] Affectation OT #${workOrderId}: pièce sortie et ajoutée définitivement (${quantityNeeded} unité(s)).`;
    const nextNotes = requirement.notes ? `${requirement.notes}\n${auditLine}` : auditLine;

    // Passer par le service, jamais par `storage` en direct: c'est lui qui
    // exécute `validateTransition` (transition légale + rôle + séparation des
    // tâches). Un appel direct au storage rouvrirait la porte dérobée.
    // Motif de sortie exceptionnelle: le service décide s'il est recevable.
    // La route ne l'interprète pas, elle le transmet.
    const overrideIssueReason =
      typeof req.body?.overrideReason === "string" ? req.body.overrideReason : undefined;

    //
    // La sortie de stock est l'effet de la transition, dans la même
    // transaction : elle ne s'exécute que si la demande passe réellement de
    // `received` à `issued` (un double clic n'en fait qu'une), et un stock
    // devenu insuffisant entre-temps annule la transition.
    let stockError: unknown = null;
    const issueResult = await partRequirementsService.updatePartRequirement(
      requirementId,
      { status: "issued", notes: nextNotes },
      String(user?.role || ""),
      user?.id,
      {
        overrideIssueReason,
        onTransition: async (tx) => {
          try {
            partUsed = await storage.addPartToWorkOrder(
              { workOrderId, partId, quantity: quantityNeeded, unitPrice },
              user?.id,
              { executor: tx, requireAvailable: true },
            );
          } catch (error) {
            stockError = error;
            throw error;
          }
        },
      },
    );

    if (!issueResult.success) {
      if (isAppError(stockError)) {
        return res.status(stockError.status).json({ message: stockError.message });
      }
      const status = issueResult.error === STALE_STATUS_ERROR ? 409 : 400;
      return res.status(status).json({ message: issueResult.error });
    }

    const updatedRequirement = issueResult.data;

    // Sortie en dérogation: le magasin n'a pas remis la pièce, il doit pouvoir
    // rapprocher son étagère. Alerte immédiate — au prochain cycle du planificateur,
    // l'information serait déjà froide. Volontairement non bloquante: la pièce
    // est sortie, un échec de notification ne doit pas faire échouer la réponse.
    if (issueResult.overrideApplied) {
      alertService
        .notifyExceptionalStockIssue({
          requirementId,
          partName: part.name,
          quantity: quantityNeeded,
          workOrderId,
          reason: (overrideIssueReason || "").trim(),
          issuedByName: (user as any)?.name ?? null,
        })
        .catch((error) => {
          log.error({ err: error, requirementId, workOrderId }, "alerte de sortie exceptionnelle non envoyée");
        });
    }

    const remainingOpen = await db
      .select({ id: partRequirements.id })
      .from(partRequirements)
      .where(
        and(
          eq(partRequirements.workOrderId, workOrderId),
          inArray(partRequirements.status, openRequirementStatuses)
        )
      )
      .limit(1);

    let updatedWorkOrder: Awaited<ReturnType<typeof storage.getWorkOrder>> | null = null;
    if (workOrder.status === "awaiting_parts" && remainingOpen.length === 0) {
      updatedWorkOrder = await storage.updateWorkOrder(workOrderId, { status: "in_progress" });
    }

    if ((global as any).broadcastUpdate) {
      (global as any).broadcastUpdate("part_used_added", {
        workOrderId,
        partUsed,
        source: "issue_requirement_to_work_order",
        requirementId,
      });

      if (updatedWorkOrder) {
        (global as any).broadcastUpdate("work_order_updated", {
          workOrderId,
          updates: { status: "in_progress" },
          workOrder: updatedWorkOrder,
          source: "requirement_issued",
          triggeredBy: user?.id ?? null,
          actor: user
            ? {
                userId: user.id,
                role: user.role,
                username: user.username,
              }
            : null,
        });
      }
    }

    return res.status(200).json({
      partUsed,
      requirement: updatedRequirement,
      workOrder: updatedWorkOrder,
      message: updatedWorkOrder
        ? "Pièce ajoutée définitivement. OT repassée en cours."
        : "Pièce ajoutée définitivement à l'OT.",
    });
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Issue part requirement to work order error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
